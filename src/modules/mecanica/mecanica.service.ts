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
        prefixo: true,
        placa: true,
        modelo: true,
        medicaoAtual: true,
        ultimaRevisao: true,
        intervaloRevisao: true,
        unidadeRevisao: true,
      },
      orderBy: { prefixo: 'asc' },
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
