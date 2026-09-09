import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { Prisma } from '../../prisma/generated/client';
import type { PainelPayload } from '../../common/painel.guard';
import { toInputJson } from '../../common/prisma/os-prisma.mapper';
import { parseOrcamentoItemsFromDto } from '../os/orcamentos/helpers/orcamento-items.helper';
import { itensParaInsumos } from '../os/orcamentos/helpers/itens-para-insumos.helper';
import type { OrcamentoItemDto } from '../os/orcamentos/dto/create-orcamento.dto';
import { haSobreposicao, intervaloInvalido } from './regras/apontamento';
import {
  casaComEquipamento,
  interpretarBusca,
  ordenarResultado,
} from './regras/busca-checklist';
import type { ChecklistModeloDto } from './dto/checklist-modelo.dto';
import { ordenarParaMaquina } from './regras/manual';
import {
  impeditivosReprovados,
  lerGrupos,
  lerRespostas,
  mesclarRespostasDoGrupo,
  pendencias,
  progressoDoGrupo,
  type RespostaGravada,
} from './regras/checklist-execucao';

/** Mesma mensagem na checagem prévia e na rede do índice único parcial. */
const MSG_APONTAMENTO_ABERTO =
  'Já existe um apontamento em andamento. Pare o atual antes de começar outro.';

/**
 * `UNIQUE (operator_id) WHERE fim IS NULL` — índice único PARCIAL, criado
 * direto em SQL porque a DSL do Prisma não representa `WHERE` em índice. O
 * Prisma Client não conhece esse constraint (não está no DMMF), então a
 * violação não chega como um `P2002` de `@@unique` normal, com `meta.target`
 * já resolvido em nome de campo — chega identificando o constraint pelo NOME
 * bruto do Postgres. É a rede que pega a corrida: duas abas do mesmo
 * mecânico clicando "iniciar" ao mesmo tempo passam juntas pela checagem da
 * aplicação e só colidem no INSERT.
 */
const CONSTRAINT_APONTAMENTO_ABERTO =
  'service_order_apontamentos_operator_aberto_key';

/** Espelha a coluna `ServiceOrder.situacao` (`String` no schema, sem enum). */
export type SituacaoOs = 'Aberta' | 'EmAndamento' | 'Concluida';

/**
 * Execução interna da OS.
 *
 * Regra que atravessa o arquivo inteiro: a empresa vem SEMPRE de
 * `painel.companyId`, nunca de parâmetro da requisição, e `execucao` é sempre
 * `'interna'`. OS de pregão não existe para este módulo — nem na lista, nem
 * no detalhe, e por isso o detalhe responde 404 e não 403: 403 confirmaria a
 * existência da OS a quem não deveria saber dela.
 */
@Injectable()
export class MecanicaService {
  constructor(private readonly prisma: PrismaService) {}

  async listarBancada(
    painel: PainelPayload,
    apenasMinhas: boolean,
    situacao?: SituacaoOs,
  ) {
    return this.prisma.serviceOrder.findMany({
      where: {
        companyId: painel.companyId,
        execucao: 'interna',
        ...(apenasMinhas
          ? { responsavelOperatorId: painel.operatorId ?? '' }
          : {}),
        ...(situacao ? { situacao } : {}),
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * O contrato com o painel é devolver a OS já com as relações da tela de
   * detalhe — sem isso, a tela quebraria em runtime com `undefined.map(...)`.
   */
  async detalhe(painel: PainelPayload, osId: string) {
    const os = await this.prisma.serviceOrder.findFirst({
      where: {
        id: osId,
        companyId: painel.companyId,
        execucao: 'interna',
      },
      include: {
        responsavel: { select: { id: true, nome: true } },
        apontamentos: {
          orderBy: { inicio: 'asc' },
          include: { operator: { select: { id: true, nome: true } } },
        },
        insumos: { orderBy: { ordem: 'asc' } },
        fotos: { orderBy: { createdAt: 'asc' } },
        ocorrencias: { orderBy: { createdAt: 'asc' } },
        laudo: true,
        // Vem junto porque a tela do orçamento é a mesma da OS: pedir numa
        // segunda chamada seria uma viagem a mais por máquina aberta.
        orcamentos: { orderBy: { createdAt: 'desc' } },
      },
    });
    if (!os) throw new NotFoundException('OS não encontrada.');
    return os;
  }

  /**
   * Quem executa precisa ser funcionário. Gestor sem `Operator` lê a bancada,
   * mas não pode assumir nem apontar: apontamento sem executor identificável
   * não serve nem para custo nem para auditoria.
   */
  private exigirOperator(painel: PainelPayload): string {
    if (!painel.operatorId) {
      throw new ForbiddenException(
        'Só funcionário cadastrado pode executar OS.',
      );
    }
    return painel.operatorId;
  }

  async assumir(painel: PainelPayload, osId: string) {
    const operatorId = this.exigirOperator(painel);
    await this.detalhe(painel, osId);
    return this.prisma.serviceOrder.update({
      where: { id: osId },
      data: { responsavelOperatorId: operatorId },
    });
  }

  /** Intervalos do mecânico, para checar colisão. */
  private async intervalosDo(operatorId: string) {
    const linhas = await this.prisma.serviceOrderApontamento.findMany({
      where: { operatorId },
      select: { id: true, inicio: true, fim: true },
    });
    return linhas.map((l) => ({ id: l.id, inicio: l.inicio, fim: l.fim }));
  }

  async iniciarApontamento(
    painel: PainelPayload,
    osId: string,
    agora: Date = new Date(),
  ) {
    const operatorId = this.exigirOperator(painel);
    await this.detalhe(painel, osId);

    const aberto = await this.prisma.serviceOrderApontamento.findFirst({
      where: { operatorId, fim: null },
    });
    if (aberto) {
      throw new ConflictException(MSG_APONTAMENTO_ABERTO);
    }

    // A checagem acima só pega OUTRO apontamento já aberto. Sem isto, um
    // mecânico que lançou 08:00–12:00 e às 11:00 aperta "Iniciar" cria um
    // segundo intervalo (11:00–agora) sobreposto ao primeiro — a mesma regra
    // que `lancarApontamento`/`editarApontamento` já aplicam.
    if (
      haSobreposicao(
        { inicio: agora, fim: null },
        await this.intervalosDo(operatorId),
      )
    ) {
      throw new ConflictException(
        'Este intervalo se sobrepõe a outro apontamento seu.',
      );
    }

    try {
      const criado = await this.prisma.serviceOrderApontamento.create({
        data: {
          serviceOrderId: osId,
          operatorId,
          lancadoPorId: painel.companyUserId,
          inicio: agora,
          fim: null,
        },
      });
      await this.marcarEmAndamento(osId);
      return criado;
    } catch (erro) {
      this.repropagarOuConflito(erro);
    }
  }

  /**
   * A checagem prévia em `iniciarApontamento` resolve o caso normal, mas não
   * fecha a corrida: duas abas do mesmo mecânico podem passar juntas por ela
   * e chegar juntas no INSERT. Quem garante de verdade é o índice único
   * parcial do banco — este método traduz a violação dele (identificada pelo
   * NOME do constraint, não por campo) na mesma `ConflictException` amigável
   * da checagem prévia. Qualquer outro erro sobe intacto.
   */
  private repropagarOuConflito(erro: unknown): never {
    if (
      erro instanceof Prisma.PrismaClientKnownRequestError &&
      erro.code === 'P2002' &&
      this.miraNoIndiceDeApontamentoAberto(erro.meta?.target)
    ) {
      throw new ConflictException(MSG_APONTAMENTO_ABERTO);
    }
    throw erro;
  }

  /**
   * `meta.target` vem resolvido em array de campos quando o Prisma reconhece
   * o índice (caso normal de `@@unique`); para este constraint, que não está
   * no DMMF, vem como string crua com o NOME do constraint. Trata os dois
   * formatos sem arriscar `String()` num valor que pode não ser string.
   */
  private miraNoIndiceDeApontamentoAberto(target: unknown): boolean {
    if (typeof target === 'string') {
      return target.includes(CONSTRAINT_APONTAMENTO_ABERTO);
    }
    if (Array.isArray(target)) {
      return target.includes(CONSTRAINT_APONTAMENTO_ABERTO);
    }
    return false;
  }

  async pararApontamento(
    painel: PainelPayload,
    apontamentoId: string,
    agora: Date = new Date(),
  ) {
    const operatorId = this.exigirOperator(painel);
    const aberto = await this.prisma.serviceOrderApontamento.findFirst({
      where: { id: apontamentoId, operatorId, fim: null },
    });
    if (!aberto) {
      throw new NotFoundException('Apontamento aberto não encontrado.');
    }

    if (intervaloInvalido(aberto.inicio, agora)) {
      throw new BadRequestException('O fim precisa ser depois do início.');
    }
    return this.prisma.serviceOrderApontamento.update({
      where: { id: apontamentoId },
      data: { fim: agora },
    });
  }

  async lancarApontamento(
    painel: PainelPayload,
    osId: string,
    inicio: Date,
    fim: Date,
    observacao: string | null,
  ) {
    const operatorId = this.exigirOperator(painel);
    await this.detalhe(painel, osId);

    if (intervaloInvalido(inicio, fim)) {
      throw new BadRequestException('O fim precisa ser depois do início.');
    }
    if (haSobreposicao({ inicio, fim }, await this.intervalosDo(operatorId))) {
      throw new ConflictException(
        'Este intervalo se sobrepõe a outro apontamento seu.',
      );
    }

    const criado = await this.prisma.serviceOrderApontamento.create({
      data: {
        serviceOrderId: osId,
        operatorId,
        lancadoPorId: painel.companyUserId,
        inicio,
        fim,
        observacao,
      },
    });
    await this.marcarEmAndamento(osId);
    return criado;
  }

  async editarApontamento(
    painel: PainelPayload,
    apontamentoId: string,
    inicio: Date,
    fim: Date | null,
    observacao: string | null,
  ) {
    const operatorId = this.exigirOperator(painel);
    const atual = await this.prisma.serviceOrderApontamento.findFirst({
      where: { id: apontamentoId, operatorId },
    });
    if (!atual) throw new NotFoundException('Apontamento não encontrado.');

    if (intervaloInvalido(inicio, fim)) {
      throw new BadRequestException('O fim precisa ser depois do início.');
    }
    if (
      haSobreposicao(
        { id: apontamentoId, inicio, fim },
        await this.intervalosDo(operatorId),
      )
    ) {
      throw new ConflictException(
        'Este intervalo se sobrepõe a outro apontamento seu.',
      );
    }

    return this.prisma.serviceOrderApontamento.update({
      where: { id: apontamentoId },
      data: { inicio, fim, observacao },
    });
  }

  async removerApontamento(painel: PainelPayload, apontamentoId: string) {
    const operatorId = this.exigirOperator(painel);
    const atual = await this.prisma.serviceOrderApontamento.findFirst({
      where: { id: apontamentoId, operatorId },
    });
    if (!atual) throw new NotFoundException('Apontamento não encontrado.');
    await this.prisma.serviceOrderApontamento.delete({
      where: { id: apontamentoId },
    });
    return { ok: true };
  }

  /** A situação anda sozinha: o primeiro apontamento tira a OS de "Aberta". */
  private async marcarEmAndamento(osId: string) {
    await this.prisma.serviceOrder.updateMany({
      where: { id: osId, situacao: 'Aberta' },
      data: { situacao: 'EmAndamento' },
    });
  }

  async adicionarPeca(
    painel: PainelPayload,
    osId: string,
    peca: {
      descricao: string;
      quantidade: number;
      valorUnit: number;
      codigo: string | null;
      marca: string | null;
      unidade: string | null;
    },
  ) {
    await this.detalhe(painel, osId);
    return this.prisma.serviceOrderInsumo.create({
      data: { serviceOrderId: osId, ...peca },
    });
  }

  /**
   * A URL vem do Storage — o arquivo sobe por `uploads` antes. Guardar
   * data-URI aqui repetiria o erro do legado (`Emergency.fotos`), que engorda
   * a linha e trava a listagem.
   */
  async adicionarFoto(
    painel: PainelPayload,
    osId: string,
    url: string,
    legenda: string | null,
  ) {
    await this.detalhe(painel, osId);
    return this.prisma.serviceOrderFoto.create({
      data: {
        serviceOrderId: osId,
        url,
        legenda,
        enviadaPorId: painel.companyUserId,
      },
    });
  }

  /**
   * Timeline imutável: cada entrada é um registro novo, nunca um update.
   * `usuario` é NOME de exibição em todo o resto do produto (ex.: o diálogo
   * de detalhe da OS em Manutenção renderiza `— {o.usuario}` direto) — gravar
   * o UUID de `companyUserId` aqui vazaria a chave interna para a tela do
   * gestor.
   */
  async adicionarOcorrencia(painel: PainelPayload, osId: string, mensagem: string) {
    await this.detalhe(painel, osId);
    return this.prisma.serviceOrderOcorrencia.create({
      data: {
        serviceOrderId: osId,
        usuario: painel.nomeExibicao,
        mensagem,
      },
    });
  }

  /**
   * Um laudo por OS (`serviceOrderId` é único). Editável livremente até
   * `concluir` carimbar `fechadoEm` — a partir daí é o documento que o
   * gestor mostra ao cliente, e não aceita mais edição.
   */
  async salvarLaudo(
    painel: PainelPayload,
    osId: string,
    dados: { causa: string; servicoFeito: string; pendencias: string | null },
  ) {
    await this.detalhe(painel, osId);
    const atual = await this.prisma.serviceOrderLaudo.findUnique({
      where: { serviceOrderId: osId },
    });
    if (atual?.fechadoEm) {
      throw new ConflictException(
        'Laudo já fechado. Reabra a OS para alterá-lo.',
      );
    }
    return this.prisma.serviceOrderLaudo.upsert({
      where: { serviceOrderId: osId },
      create: { serviceOrderId: osId, autorId: painel.companyUserId, ...dados },
      update: { ...dados },
    });
  }

  /**
   * Orçamento da oficina própria — cria ou substitui.
   *
   * Um por OS interna, identificado por `oficinaId: null` (decisão D1). Não
   * passa pelo `POST /os/orcamentos` da parceira de propósito: aquela rota
   * exige oficina convidada, força `em_pregao` e grava um lance. Nada disso
   * tem significado quando não há concorrência — não existe pregão de um
   * participante só.
   *
   * Nasce em `aguardando_aprovacao`, que é o estado que a tela do painel já
   * sabe aprovar: `podeAprovarOrcamento` olha só o status, e a aprovação já
   * grava `oficinaVencedoraId: orc.oficinaId ?? null`.
   *
   * Substituir enquanto pendente, em vez de acumular versões, é o mesmo
   * contrato do laudo: o gestor aprova UM número, e ter três rascunhos na
   * tela dele só cria dúvida sobre qual vale.
   */
  async salvarOrcamento(
    painel: PainelPayload,
    osId: string,
    dados: {
      itens: OrcamentoItemDto[];
      prazoDias?: number;
      fotos?: string[];
    },
  ) {
    const os = await this.detalhe(painel, osId);

    // Reusa a validação da parceira: cada item precisa de descrição e o total
    // tem de ser maior que zero. Orçamento de R$ 0 não é pedido de aprovação.
    const { itens, valorTotal } = parseOrcamentoItemsFromDto(dados.itens);

    // Um orçamento PENDENTE por OS — não um por OS. Recusado fica no lugar
    // como histórico, e o mecânico manda outro: é o laço normal de quem pede
    // aprovação. Bloquear depois de uma recusa deixaria a máquina parada
    // esperando uma conversa que o sistema não tem onde registrar.
    const aprovado = await this.prisma.orcamento.findFirst({
      where: { serviceOrderId: osId, oficinaId: null, status: 'aprovado' },
    });
    if (aprovado) {
      throw new ConflictException(
        'Esta OS já tem orçamento aprovado. Para gastar mais, fale com o gestor.',
      );
    }

    const atual = await this.prisma.orcamento.findFirst({
      where: {
        serviceOrderId: osId,
        oficinaId: null,
        status: 'aguardando_aprovacao',
      },
    });

    const comum = {
      itens: toInputJson(itens),
      valorTotal,
      prazoDias: dados.prazoDias ?? null,
      fotosComprovacao: toInputJson(dados.fotos ?? []),
      // Quem montou o orçamento. O modelo guarda aqui o nome de quem enviou
      // — na parceira é a oficina; aqui, o mecânico.
      operadorNome: painel.nomeExibicao,
    };

    if (atual) {
      return this.prisma.orcamento.update({
        where: { id: atual.id },
        data: comum,
      });
    }

    return this.prisma.orcamento.create({
      data: {
        companyId: painel.companyId,
        serviceOrderId: osId,
        protocolo: os.protocolo,
        oficinaId: null,
        oficinaNome: null,
        equipamento: os.equipmentNome,
        defeito: os.relato,
        status: 'aguardando_aprovacao',
        ...comum,
      },
    });
  }

  // ────────────────────── execução de checklist ────────────────────────────

  /**
   * Abre um checklist para preencher.
   *
   * O número do documento vem do SERVIDOR, dentro da transação: numeração
   * local (`max + 1` no aparelho) não sobrevive a dois mecânicos com o mesmo
   * checklist aberto, e o "Doc." é o que eles citam no telefone.
   */
  async iniciarChecklist(
    painel: PainelPayload,
    dados: { modeloId: string; equipamentoId: string; serviceOrderId?: string },
  ) {
    const operatorId = this.exigirOperator(painel);

    const modelo = await this.prisma.checklistModelo.findFirst({
      where: { id: dados.modeloId, companyId: painel.companyId, ativo: true },
    });
    if (!modelo) throw new NotFoundException('Checklist não encontrado ou arquivado.');

    const equipamento = await this.prisma.equipment.findFirst({
      where: { id: dados.equipamentoId, companyId: painel.companyId },
      select: { id: true },
    });
    if (!equipamento) throw new NotFoundException('Equipamento não encontrado.');

    if (modelo.exigeOs === 'exige_os' && !dados.serviceOrderId) {
      throw new BadRequestException(
        `O checklist ${modelo.codigo} só é preenchido dentro de uma ordem de serviço.`,
      );
    }
    if (dados.serviceOrderId) {
      // `detalhe` já garante empresa + execução interna, e responde 404 para
      // OS de pregão — o mesmo recorte do resto do módulo.
      await this.detalhe(painel, dados.serviceOrderId);
    }

    return this.prisma.$transaction(async (tx) => {
      const ultimo = await tx.checklistExecucao.findFirst({
        where: { companyId: painel.companyId },
        orderBy: { numeroDoc: 'desc' },
        select: { numeroDoc: true },
      });

      return tx.checklistExecucao.create({
        data: {
          companyId: painel.companyId,
          modeloId: modelo.id,
          equipmentId: dados.equipamentoId,
          serviceOrderId: dados.serviceOrderId ?? null,
          operatorId,
          numeroDoc: (ultimo?.numeroDoc ?? 0) + 1,
        },
      });
    });
  }

  async listarExecucoes(
    painel: PainelPayload,
    filtros: { status?: string; serviceOrderId?: string; equipamentoId?: string } = {},
  ) {
    return this.prisma.checklistExecucao.findMany({
      where: {
        companyId: painel.companyId,
        ...(filtros.status ? { status: filtros.status } : {}),
        ...(filtros.serviceOrderId ? { serviceOrderId: filtros.serviceOrderId } : {}),
        ...(filtros.equipamentoId ? { equipmentId: filtros.equipamentoId } : {}),
      },
      include: { modelo: { select: { codigo: true, nome: true } } },
      orderBy: { iniciadaEm: 'desc' },
    });
  }

  /**
   * O documento inteiro, com o progresso já calculado por grupo.
   *
   * O progresso é DERIVADO das respostas, nunca guardado: um contador gravado
   * junto envelhece à primeira divergência e passa a mentir sobre o que falta.
   */
  async obterExecucao(painel: PainelPayload, id: string) {
    const execucao = await this.prisma.checklistExecucao.findFirst({
      where: { id, companyId: painel.companyId },
      include: { modelo: true },
    });
    if (!execucao) throw new NotFoundException('Checklist não encontrado.');

    const grupos = lerGrupos(execucao.modelo.grupos);
    const respostas = lerRespostas(execucao.respostas);

    return {
      ...execucao,
      progresso: grupos.map((g) => ({
        grupoId: g.id,
        ...progressoDoGrupo(g, respostas),
      })),
      pendencias: pendencias(grupos, respostas),
    };
  }

  private async execucaoAberta(painel: PainelPayload, id: string) {
    const execucao = await this.prisma.checklistExecucao.findFirst({
      where: { id, companyId: painel.companyId },
      include: { modelo: true },
    });
    if (!execucao) throw new NotFoundException('Checklist não encontrado.');
    if (execucao.status !== 'aberta') {
      throw new ConflictException(
        execucao.status === 'concluida'
          ? 'Este checklist já foi concluído. Para corrigir, abra outro.'
          : 'Este checklist foi cancelado.',
      );
    }
    return execucao;
  }

  /**
   * Grava as respostas de UM grupo.
   *
   * O merge preserva os outros grupos — é o que faz o "cancelar" de uma seção
   * ser seguro e o trabalho de terça sobreviver até quinta. E só entra
   * resposta de item que pertence ao grupo: bug de tela não escreve em outra
   * seção.
   */
  async salvarRespostasDoGrupo(
    painel: PainelPayload,
    id: string,
    grupoId: string,
    novas: Record<string, RespostaGravada>,
  ) {
    const execucao = await this.execucaoAberta(painel, id);

    const grupo = lerGrupos(execucao.modelo.grupos).find((g) => g.id === grupoId);
    if (!grupo) throw new NotFoundException('Seção não encontrada neste checklist.');

    const respostas = mesclarRespostasDoGrupo(
      lerRespostas(execucao.respostas),
      grupo,
      novas,
    );

    await this.prisma.checklistExecucao.update({
      where: { id },
      data: { respostas: toInputJson(respostas) },
    });

    return { grupoId, ...progressoDoGrupo(grupo, respostas) };
  }

  /**
   * Conclui, e torna o documento imutável.
   *
   * Correção depois é checklist novo, não edição — é o que faz o documento
   * valer alguma coisa quando alguém pergunta "como a máquina estava".
   *
   * Item impeditivo reprovado NÃO impede concluir: o registro fiel do que foi
   * encontrado é o produto, e um checklist de avarias pode ter quinze não
   * conformidades legítimas. Ele volta na resposta, para a tela mostrar.
   */
  async concluirChecklist(
    painel: PainelPayload,
    id: string,
    dados: {
      assinaturaExecutante: string;
      assinaturaRecebedor?: string;
      recebedorNome?: string;
      recebedorDocumento?: string;
    },
    agora: Date = new Date(),
  ) {
    const execucao = await this.execucaoAberta(painel, id);

    const grupos = lerGrupos(execucao.modelo.grupos);
    const respostas = lerRespostas(execucao.respostas);

    const faltando = pendencias(grupos, respostas);
    if (faltando.length > 0) {
      throw new BadRequestException(
        `Faltam ${faltando.length} ${faltando.length === 1 ? 'item' : 'itens'}: ` +
          faltando
            .slice(0, 3)
            .map((p) => `${p.grupoNome} nº ${p.numero}`)
            .join(', ') +
          (faltando.length > 3 ? '…' : '.'),
      );
    }

    if (execucao.modelo.exigeAssinaturaRecebedor) {
      // Traço anônimo não prova nada: quem recebe a máquina se identifica.
      if (!dados.assinaturaRecebedor || !dados.recebedorNome?.trim()) {
        throw new BadRequestException(
          'Este checklist exige a assinatura e o nome de quem recebe a máquina.',
        );
      }
    }

    const concluida = await this.prisma.checklistExecucao.update({
      where: { id },
      data: {
        status: 'concluida',
        concluidaEm: agora,
        assinaturaExecutante: dados.assinaturaExecutante,
        assinaturaRecebedor: dados.assinaturaRecebedor ?? null,
        recebedorNome: dados.recebedorNome?.trim() || null,
        recebedorDocumento: dados.recebedorDocumento?.trim() || null,
      },
    });

    const graves = impeditivosReprovados(grupos, respostas);

    /**
     * Não conformidade vira linha na timeline da OS.
     *
     * Custo baixo, valor alto: o laudo passa a ter a inspeção junto, sem
     * ninguém digitar de novo. Só quando há OS — checklist avulso não tem
     * onde escrever.
     */
    if (execucao.serviceOrderId && graves.length > 0) {
      await this.prisma.serviceOrderOcorrencia.createMany({
        data: graves.map((g) => ({
          serviceOrderId: execucao.serviceOrderId as string,
          usuario: painel.nomeExibicao,
          mensagem:
            `Checklist ${execucao.modelo.codigo} · ${g.grupoNome} nº ${g.numero}: ` +
            `${g.descricao} — ${lerRespostas(execucao.respostas)[g.itemId]?.observacao ?? 'não conforme'}`,
        })),
      });
    }

    return { ...concluida, impeditivosReprovados: graves };
  }

  /**
   * Cancela com motivo.
   *
   * Nada fecha sozinho: fechar automaticamente um checklist de segurança pela
   * metade é pior que deixá-lo aberto. Cancelar é ato explícito, e o motivo é
   * o que o gestor lê depois.
   */
  async cancelarChecklist(painel: PainelPayload, id: string, motivo: string) {
    const execucao = await this.execucaoAberta(painel, id);

    return this.prisma.checklistExecucao.update({
      where: { id: execucao.id },
      data: { status: 'cancelada', motivoCancelamento: motivo.trim() },
    });
  }

  /** Anexa a foto de um item às respostas, sem mexer no resto. */
  async anexarFotoAoItem(
    painel: PainelPayload,
    id: string,
    itemId: string,
    url: string,
  ) {
    const execucao = await this.execucaoAberta(painel, id);

    const existe = lerGrupos(execucao.modelo.grupos).some((g) =>
      g.itens.some((i) => i.id === itemId),
    );
    if (!existe) throw new NotFoundException('Item não encontrado neste checklist.');

    const respostas = lerRespostas(execucao.respostas);
    const atual = respostas[itemId] ?? {};
    respostas[itemId] = { ...atual, fotos: [...(atual.fotos ?? []), url] };

    await this.prisma.checklistExecucao.update({
      where: { id },
      data: { respostas: toInputJson(respostas) },
    });

    return { itemId, fotos: respostas[itemId].fotos };
  }

  // ──────────────────────────────── manuais ────────────────────────────────

  /**
   * Os manuais que servem a uma máquina, do mais específico para o mais geral.
   *
   * Sem `equipamentoId`, devolve o acervo inteiro da empresa — é a visão de
   * quem administra, não a de quem está na máquina.
   */
  async listarManuais(painel: PainelPayload, equipamentoId?: string) {
    const manuais = await this.prisma.manualEquipamento.findMany({
      where: { companyId: painel.companyId, ativo: true },
      orderBy: { titulo: 'asc' },
    });

    if (!equipamentoId) return manuais;

    const maquina = await this.prisma.equipment.findFirst({
      where: { id: equipamentoId, companyId: painel.companyId },
      select: { id: true, modelo: true, tipo: true },
    });
    if (!maquina) throw new NotFoundException('Equipamento não encontrado.');

    return ordenarParaMaquina(manuais, maquina);
  }

  /**
   * Registra o manual já subido para o Storage.
   *
   * Vínculo: `equipamentoId` prende a uma máquina; `modelo` ou `tipo` alcançam
   * a família; nada preenchido vale para a frota inteira. Guardar os três
   * evita subir o mesmo PDF uma vez por máquina — e atualizá-lo doze vezes
   * quando o fabricante revisa.
   */
  async registrarManual(
    painel: PainelPayload,
    dados: {
      titulo: string;
      categoria?: string;
      url: string;
      mimetype: string;
      tamanhoBytes: number;
      equipamentoId?: string;
      modelo?: string;
      tipo?: string;
    },
  ) {
    if (dados.equipamentoId) {
      const existe = await this.prisma.equipment.findFirst({
        where: { id: dados.equipamentoId, companyId: painel.companyId },
        select: { id: true },
      });
      if (!existe) throw new NotFoundException('Equipamento não encontrado.');
    }

    return this.prisma.manualEquipamento.create({
      data: {
        companyId: painel.companyId,
        titulo: dados.titulo,
        categoria: dados.categoria ?? null,
        url: dados.url,
        mimetype: dados.mimetype,
        tamanhoBytes: dados.tamanhoBytes,
        equipmentId: dados.equipamentoId ?? null,
        modelo: dados.modelo ?? null,
        tipo: dados.tipo ?? null,
      },
    });
  }

  /**
   * Arquiva em vez de apagar: o arquivo continua no Storage e a URL pode
   * estar num histórico. Sumir com ele quebraria link antigo sem aviso.
   */
  async arquivarManual(painel: PainelPayload, id: string) {
    const manual = await this.prisma.manualEquipamento.findFirst({
      where: { id, companyId: painel.companyId },
      select: { id: true },
    });
    if (!manual) throw new NotFoundException('Manual não encontrado.');

    return this.prisma.manualEquipamento.update({
      where: { id },
      data: { ativo: false },
    });
  }

  // ─────────────────────────── checklists da empresa ───────────────────────

  /**
   * Os checklists que a empresa mantém.
   *
   * `busca` é uma caixa só — código ou descrição — porque é assim que o
   * mecânico procura: ou sabe o número ("roda o 57"), ou lembra do nome. Duas
   * caixas obrigariam a decidir antes de digitar.
   *
   * `equipamentoId` NÃO filtra: ele ordena, trazendo primeiro os que casam com
   * a máquina. Esconder resultado num app de campo é como o mecânico perde a
   * confiança e liga para o encarregado — que é o que o produto evita.
   */
  async listarModelosDeChecklist(
    painel: PainelPayload,
    opcoes: { busca?: string; equipamentoId?: string; incluirArquivados?: boolean } = {},
  ) {
    const busca = interpretarBusca(opcoes.busca);

    const modelos = await this.prisma.checklistModelo.findMany({
      where: {
        companyId: painel.companyId,
        ...(opcoes.incluirArquivados ? {} : { ativo: true }),
        ...(busca.tipo === 'texto'
          ? { nome: { contains: busca.termo, mode: 'insensitive' } }
          : {}),
      },
      orderBy: { codigo: 'asc' },
    });

    const porCodigo =
      busca.tipo === 'codigo'
        ? modelos.filter((m) => String(m.codigo).startsWith(busca.prefixo))
        : modelos;

    const ordenados = ordenarResultado(porCodigo, busca);
    if (!opcoes.equipamentoId) return ordenados;

    const equipamento = await this.prisma.equipment.findFirst({
      where: { id: opcoes.equipamentoId, companyId: painel.companyId },
      select: { descricao: true, modelo: true, tipo: true },
    });
    if (!equipamento) return ordenados;

    // Sugeridos primeiro, o resto depois — sem tirar ninguém da lista.
    const sugeridos = ordenados.filter((m) => casaComEquipamento(m.keywords, equipamento));
    const demais = ordenados.filter((m) => !sugeridos.includes(m));
    return [...sugeridos, ...demais];
  }

  async obterModeloDeChecklist(painel: PainelPayload, id: string) {
    const modelo = await this.prisma.checklistModelo.findFirst({
      where: { id, companyId: painel.companyId },
    });
    if (!modelo) throw new NotFoundException('Checklist não encontrado.');
    return modelo;
  }

  /**
   * Cria ou altera um checklist da empresa.
   *
   * `version` sobe a cada alteração para o app saber que o cache dele
   * envelheceu. Execução já aberta continua na versão em que nasceu — mudar o
   * documento debaixo de quem está respondendo perderia trabalho.
   */
  async salvarModeloDeChecklist(
    painel: PainelPayload,
    dados: ChecklistModeloDto,
    id?: string,
  ) {
    const grupos = dados.grupos.map((g, i) => ({
      id: `g${g.codigo ?? i + 1}`,
      codigo: g.codigo ?? i + 1,
      nome: g.nome,
      itens: g.itens.map((item) => ({
        id: `g${g.codigo ?? i + 1}-i${item.numero}`,
        numero: item.numero,
        descricao: item.descricao,
        obrigatorio: item.obrigatorio ?? true,
        foto: item.foto ?? 'nao',
        impeditivo: item.impeditivo ?? false,
      })),
    }));

    const comum = {
      nome: dados.nome,
      familia: dados.familia ?? null,
      tipoMaquina: dados.tipoMaquina ?? null,
      keywords: toInputJson(dados.keywords ?? []),
      grupos: toInputJson(grupos),
      exigeOs: dados.exigeOs ?? 'opcional',
      exigeAssinaturaRecebedor: dados.exigeAssinaturaRecebedor ?? false,
      ativo: dados.ativo ?? true,
    };

    if (id) {
      await this.obterModeloDeChecklist(painel, id);
      return this.prisma.checklistModelo.update({
        where: { id },
        data: { ...comum, version: { increment: 1 } },
      });
    }

    const jaExiste = await this.prisma.checklistModelo.findFirst({
      where: { companyId: painel.companyId, codigo: dados.codigo },
      select: { id: true, nome: true },
    });
    if (jaExiste) {
      // Dois "57" na mesma empresa tornariam ambíguo o que o mecânico fala
      // com o encarregado.
      throw new ConflictException(
        `O código ${dados.codigo} já é do checklist "${jaExiste.nome}".`,
      );
    }

    return this.prisma.checklistModelo.create({
      data: { companyId: painel.companyId, codigo: dados.codigo, ...comum },
    });
  }

  /**
   * Arquiva em vez de apagar: execução antiga aponta para o modelo, e apagar
   * deixaria checklist preenchido sem saber do que ele é.
   */
  async arquivarModeloDeChecklist(painel: PainelPayload, id: string) {
    await this.obterModeloDeChecklist(painel, id);
    return this.prisma.checklistModelo.update({
      where: { id },
      data: { ativo: false },
    });
  }

  /**
   * Preventivas da frota da empresa.
   *
   * Devolve o cru (`medicaoAtual`, `ultimaRevisao`, `intervaloRevisao`) e
   * deixa o cálculo de "vencida / próxima / em dia" com o app, que já tem
   * `features/preventiva/regras.ts` fazendo isso em função pura. Calcular
   * aqui criaria uma segunda verdade sobre a mesma conta.
   *
   * Só equipamento COM intervalo definido: sem intervalo não existe próxima
   * revisão, e listar todo o pátio afogaria a tela do mecânico.
   */
  async listarPreventivas(painel: PainelPayload) {
    return this.prisma.equipment.findMany({
      where: {
        companyId: painel.companyId,
        intervaloRevisao: { not: null },
        status: { not: 'inativo' },
      },
      select: {
        id: true,
        // `descricao` é como o Equipment identifica a máquina; não existe
        // coluna `prefixo` — o app chama de prefixo o que o back guarda aqui.
        descricao: true,
        tipo: true,
        placa: true,
        modelo: true,
        medicaoAtual: true,
        ultimaRevisao: true,
        intervaloRevisao: true,
        unidadeRevisao: true,
      },
      orderBy: { descricao: 'asc' },
    });
  }

  /**
   * Executa a revisão: grava o histórico e move a régua da máquina.
   *
   * Escrever `ultimaRevisao = leitura` é o que projeta a próxima — sem isso a
   * máquina ficaria vencida para sempre, mesmo revisada.
   */
  async executarPreventiva(
    painel: PainelPayload,
    equipamentoId: string,
    dados: { leitura: number; servicos?: string; custo?: number },
    agora: Date = new Date(),
  ) {
    const equipamento = await this.prisma.equipment.findFirst({
      where: { id: equipamentoId, companyId: painel.companyId },
      select: { id: true, medicaoAtual: true, unidadeRevisao: true },
    });
    if (!equipamento) throw new NotFoundException('Equipamento não encontrado.');

    // Medidor não anda para trás. Aceitar leitura menor bagunçaria o histórico
    // e faria a próxima revisão ser projetada para um ponto já passado.
    const atual = equipamento.medicaoAtual ?? 0;
    if (dados.leitura < atual) {
      throw new BadRequestException(
        `A leitura (${dados.leitura}) não pode ser menor que a atual da máquina (${atual}).`,
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const revisao = await tx.equipmentRevision.create({
        data: {
          equipmentId: equipamentoId,
          data: agora,
          leitura: dados.leitura,
          unidade: equipamento.unidadeRevisao ?? 'h',
          servicos: dados.servicos ?? null,
          custo: dados.custo ?? null,
          createdById: painel.companyUserId,
        },
      });

      await tx.equipment.update({
        where: { id: equipamentoId },
        data: { medicaoAtual: dados.leitura, ultimaRevisao: dados.leitura },
      });

      return revisao;
    });
  }

  /**
   * Decide o orçamento interno.
   *
   * Existe aqui, e não na rota de aprovação da parceira, por dois motivos: o
   * painel já fala com `/mecanica/*` usando o token do Supabase (a rota da
   * parceira exige token do back, que o painel não tem), e é aqui que mora a
   * conversão de peça em insumo — a regra D5.
   *
   * Quem executa não aprova o próprio serviço. Sem essa trava, o mecânico
   * autorizaria o próprio gasto, e a aprovação viraria carimbo.
   */
  async decidirOrcamento(
    painel: PainelPayload,
    osId: string,
    decisao: 'aprovar' | 'recusar',
    agora: Date = new Date(),
  ) {
    const os = await this.detalhe(painel, osId);

    if (painel.operatorId && os.responsavelOperatorId === painel.operatorId) {
      throw new ForbiddenException(
        'Quem executa a OS não aprova o próprio orçamento. Peça ao gestor.',
      );
    }

    const orcamento = await this.prisma.orcamento.findFirst({
      where: {
        serviceOrderId: osId,
        oficinaId: null,
        status: 'aguardando_aprovacao',
      },
    });
    if (!orcamento) {
      throw new NotFoundException('Não há orçamento aguardando aprovação nesta OS.');
    }

    if (decisao === 'recusar') {
      return this.prisma.orcamento.update({
        where: { id: orcamento.id },
        data: { status: 'recusado' },
      });
    }

    return this.prisma.$transaction(async (tx) => {
      const aprovado = await tx.orcamento.update({
        where: { id: orcamento.id },
        data: { status: 'aprovado' },
      });

      /**
       * D5: peça orçada vira peça consumida, e o orçamento deixa de ser custo.
       * Sem isto, orçar um filtro e depois lançá-lo contaria duas vezes — e
       * ninguém perceberia, porque cada número está certo no seu lugar.
       */
      const jaExistem = await tx.serviceOrderInsumo.count({
        where: { serviceOrderId: osId },
      });
      const insumos = itensParaInsumos(orcamento.itens, osId, jaExistem);
      if (insumos.length > 0) {
        await tx.serviceOrderInsumo.createMany({ data: insumos });
      }

      /**
       * Carimba o valor autorizado, mas NÃO mexe em `status` nem `situacao`.
       *
       * `ServiceOrder.status` é o ciclo do pregão (`aguardando_orcamento`,
       * `em_pregao`, `aprovado`) e não descreve OS interna; escrever nele faria
       * a OS aparecer em telas que filtram o fluxo de parceira. A situação da
       * execução continua sendo `situacao`, e ela não muda por aprovar gasto:
       * o serviço segue em andamento.
       */
      await tx.serviceOrder.update({
        where: { id: osId },
        data: {
          aprovadoEm: agora,
          valorAprovado: orcamento.valorTotal,
          ordemServicoAprovadaId: orcamento.id,
        },
      });

      return { ...aprovado, insumosCriados: insumos.length };
    });
  }

  /**
   * Concluir carimba o laudo e o torna imutável — é o documento que o gestor
   * mostra ao cliente.
   *
   * Apontamento aberto barra a conclusão de propósito: fechar a OS com o
   * cronômetro rodando gravaria um intervalo que só cresce, e o custo da OS
   * mudaria sozinho depois de ela estar fechada.
   */
  async concluir(painel: PainelPayload, osId: string, agora: Date = new Date()) {
    await this.detalhe(painel, osId);

    const laudo = await this.prisma.serviceOrderLaudo.findUnique({
      where: { serviceOrderId: osId },
    });
    if (!laudo) {
      throw new BadRequestException(
        'Preencha o laudo antes de concluir a OS.',
      );
    }

    const aberto = await this.prisma.serviceOrderApontamento.findFirst({
      where: { serviceOrderId: osId, fim: null },
    });
    if (aberto) {
      throw new ConflictException(
        'Pare o apontamento em andamento antes de concluir.',
      );
    }

    if (!laudo.fechadoEm) {
      await this.prisma.serviceOrderLaudo.update({
        where: { serviceOrderId: osId },
        data: { fechadoEm: agora },
      });
    }
    return this.prisma.serviceOrder.update({
      where: { id: osId },
      data: { situacao: 'Concluida' },
    });
  }
}
