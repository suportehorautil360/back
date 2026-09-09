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

  async listarBancada(painel: PainelPayload, apenasMinhas: boolean) {
    return this.prisma.serviceOrder.findMany({
      where: {
        companyId: painel.companyId,
        execucao: 'interna',
        ...(apenasMinhas
          ? { responsavelOperatorId: painel.operatorId ?? '' }
          : {}),
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async detalhe(painel: PainelPayload, osId: string) {
    const os = await this.prisma.serviceOrder.findFirst({
      where: {
        id: osId,
        companyId: painel.companyId,
        execucao: 'interna',
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

  /** Timeline imutável: cada entrada é um registro novo, nunca um update. */
  async adicionarOcorrencia(painel: PainelPayload, osId: string, mensagem: string) {
    await this.detalhe(painel, osId);
    return this.prisma.serviceOrderOcorrencia.create({
      data: {
        serviceOrderId: osId,
        usuario: painel.companyUserId,
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
