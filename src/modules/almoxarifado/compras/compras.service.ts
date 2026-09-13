import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../../../prisma/generated/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { registrarAuditoriaSuprimentos } from '../auditoria';
import { proximoNumeroDocumento } from '../helpers/numero-documento.helper';
import { enviarNotificacoes, type NotificacaoPronta } from '../notificacoes/almoxarifado-notificacoes';
import {
  STATUS_ORDEM_COMPRA,
  acaoPermitida,
  compararLugarNaFila,
  exigeAprovacao,
  podeAprovarOrdemDeCompra,
  situacaoDoItemDeSolicitacao,
  valorTotalDaOrdem,
  type OrigemParaCobertura,
} from '../regras/compras';
import { comRetryDeContencao, compararPorPeca, travarRequisicao } from '../transacao';
import { recalcularStatusDeCompraDaOs } from './cobertura';
import { recalcularEstadoDaSolicitacao } from './estado-da-solicitacao';
import { PRIORIDADES_MANUAIS } from './dto/solicitacao-compra.dto';
import { montarNotificacaoAguardandoAprovacao, montarNotificacaoOrdemDevolvida } from './notificacoes-compras';

/**
 * Compras: a SOLICITAÇÃO (a necessidade) e a ORDEM DE COMPRA (o compromisso com
 * o fornecedor).
 *
 * Todo ato de escrita segue o mesmo molde de `almoxarifado.service.ts`:
 * valida a forma do pedido antes de abrir transação; dentro dela, trava o
 * documento primeiro e relê tudo DEPOIS da trava; transição de estado por
 * `updateMany` guardado no estado de origem, com `count` checado e `throw`
 * dentro da transação (é o rollback que desfaz o que já foi escrito); saldo só
 * com aritmética relativa no SQL; aviso montado dentro e gravado depois do
 * commit.
 *
 * Ordem única de trava — a mesma em todo método deste arquivo e dos que tocam
 * as mesmas linhas, senão é deadlock:
 *
 *   cabeçalho da OC → requisições (por id) → linhas de item de SC (por id) →
 *   `peca_saldos` (por `pecaId`) → cabeçalhos de SC (por id) → OS.
 *
 * Linhas de item ANTES do cabeçalho da SC: `cancelarSolicitacoesDasFaltas`
 * (`solicitacao-de-falta.ts`) e o recebimento (`recebimento.ts`) travam as
 * linhas de item e só depois escrevem no cabeçalho. Travar o cabeçalho
 * primeiro aqui abriria um ciclo com eles (este ato segurando o cabeçalho e
 * esperando a linha; o outro segurando a linha e esperando o cabeçalho).
 *
 * Cabeçalho DEPOIS de `peca_saldos`: o recebimento trava o saldo e só então
 * grava o cabeçalho (`recalcularEstadoDaSolicitacao`). O cancelamento da
 * requisição grava o cabeçalho antes do saldo, mas não forma ciclo com os atos
 * daqui que travam saldo (emitir, cancelar ou encerrar OC já comprometida):
 * ele só alcança SC de falta, e esses atos chegam a toda SC de falta pela trava
 * da requisição dela, que os dois tomam antes de qualquer linha de SC.
 *
 * O cabeçalho só é travado onde o estado dele é recalculado, logo antes do
 * recálculo. A checagem de "SC viva ou encerrada" feita antes disso vale
 * porque quem encerra uma SC (rejeitar/cancelar aqui, cancelar a requisição)
 * trava as linhas de item abertas dela primeiro — e o ato daqui já as segura.
 */

export const STATUS_SOLICITACAO = ['pendente', 'em_cotacao', 'aprovada', 'rejeitada', 'cancelada'] as const;
/** O que ainda dá trabalho a Compras. */
const SOLICITACAO_NA_FILA = ['pendente', 'em_cotacao'];
const ORDEM_EM_ANDAMENTO = ['rascunho', 'aguardando_aprovacao', 'emitida', 'enviada', 'recebida_parcial'];
/** Atos com motivo — nunca derivados dos itens (`statusDaSolicitacao`). */
const SOLICITACAO_ENCERRADA = new Set(['rejeitada', 'cancelada']);
/**
 * Falta de OS e peça adicional nascem da requisição e acompanham a requisição:
 * quem as encerra é o cancelamento dela, não Compras.
 */
const ORIGEM_QUE_COMPRAS_ENCERRA = new Set(['manual', 'estoque_minimo']);
const LIMITE_DA_LISTAGEM = 200;

/**
 * A ordem única de trava entre ids. É o comparador de `transacao.ts` — ele
 * compara a string crua, então vale para qualquer id, não só `pecaId`. Mesma
 * ordem do `ORDER BY id` do Postgres para UUID canônico em minúsculas, que é o
 * que `cancelarSolicitacoesDasFaltas` usa.
 */
const compararIds = compararPorPeca;

function milesimos(n: number): number {
  return Math.round(n * 1000);
}

function distintos(valores: Array<string | null | undefined>): string[] {
  return [...new Set(valores.filter((v): v is string => typeof v === 'string' && v.length > 0))].sort(compararIds);
}

function menorData(datas: Array<Date | null>): Date | null {
  let menor: Date | null = null;
  for (const d of datas) {
    if (d && (!menor || d.getTime() < menor.getTime())) menor = d;
  }
  return menor;
}

function textoObrigatorio(valor: string | undefined, rotulo: string): string {
  const limpo = (valor ?? '').trim();
  if (limpo.length < 3) throw new BadRequestException(`${rotulo} precisa de pelo menos 3 caracteres.`);
  return limpo;
}

/** Ausente = não mexer; `null` ou só espaço = apagar. */
function textoOpcional(valor: string | null | undefined): string | null | undefined {
  if (valor === undefined) return undefined;
  if (valor === null) return null;
  const limpo = valor.trim();
  return limpo.length > 0 ? limpo : null;
}

function dataOpcional(valor: string | null | undefined): Date | null | undefined {
  if (valor === undefined) return undefined;
  if (valor === null) return null;
  const data = new Date(valor);
  if (Number.isNaN(data.getTime())) throw new BadRequestException(`Data inválida: ${valor}.`);
  return data;
}

/** Sem linha em `company_settings` ou coluna nula: sem limite — toda OC pede aprovação. */
function limiteDe(config: { comprasLimiteAprovacao: Prisma.Decimal | null } | null): number | null {
  if (!config || config.comprasLimiteAprovacao === null) return null;
  return Number(config.comprasLimiteAprovacao);
}

// --- Leituras ----------------------------------------------------------------

const ORIGEM_COM_ORDEM = {
  quantidade: true,
  quantidadeRecebida: true,
  ordemCompraItem: {
    select: { ordemCompraId: true, ordemCompra: { select: { numero: true, status: true } } },
  },
} satisfies Prisma.OrdemCompraItemOrigemSelect;
type OrigemComOrdem = Prisma.OrdemCompraItemOrigemGetPayload<{ select: typeof ORIGEM_COM_ORDEM }>;

function paraCobertura(origens: OrigemComOrdem[]): OrigemParaCobertura[] {
  return origens.map((o) => ({
    statusOrdemCompra: o.ordemCompraItem.ordemCompra.status,
    quantidade: Number(o.quantidade),
    quantidadeRecebida: Number(o.quantidadeRecebida),
  }));
}

const PECA_RESUMIDA = { id: true, codigoInterno: true, descricao: true, unidade: true } satisfies Prisma.PecaSelect;

const SOLICITACAO_COMPLETA = {
  id: true,
  numero: true,
  origem: true,
  status: true,
  prioridade: true,
  justificativa: true,
  createdAt: true,
  deposito: { select: { id: true, nome: true } },
  serviceOrder: { select: { id: true, protocolo: true, equipmentNome: true } },
  itens: {
    select: {
      id: true,
      quantidade: true,
      prioridade: true,
      dataNecessidade: true,
      status: true,
      requisicaoItemId: true,
      peca: { select: PECA_RESUMIDA },
      origensOc: { select: ORIGEM_COM_ORDEM },
    },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  },
} satisfies Prisma.SolicitacaoCompraSelect;
type SolicitacaoCompleta = Prisma.SolicitacaoCompraGetPayload<{ select: typeof SOLICITACAO_COMPLETA }>;

function apresentarSolicitacao(sc: SolicitacaoCompleta) {
  const encerrada = SOLICITACAO_ENCERRADA.has(sc.status);
  return {
    id: sc.id,
    numero: sc.numero,
    origem: sc.origem,
    status: sc.status,
    prioridade: sc.prioridade,
    justificativa: sc.justificativa,
    createdAt: sc.createdAt,
    deposito: { id: sc.deposito.id, nome: sc.deposito.nome },
    serviceOrder: sc.serviceOrder
      ? { id: sc.serviceOrder.id, protocolo: sc.serviceOrder.protocolo, equipmentNome: sc.serviceOrder.equipmentNome }
      : null,
    itens: sc.itens.map((i) => {
      const quantidade = Number(i.quantidade);
      const situacao = situacaoDoItemDeSolicitacao(quantidade, paraCobertura(i.origensOc));
      return {
        id: i.id,
        peca: { id: i.peca.id, codigoInterno: i.peca.codigoInterno, descricao: i.peca.descricao, unidade: i.peca.unidade },
        quantidade,
        prioridade: i.prioridade,
        dataNecessidade: i.dataNecessidade,
        status: i.status,
        requisicaoItemId: i.requisicaoItemId,
        comprado: situacao.comprado,
        emCotacao: situacao.emCotacao,
        recebido: situacao.recebido,
        // O que a cotação (`substituirItens`) aceitaria: item que não está
        // `aberta`, ou de solicitação rejeitada/cancelada, não entra em OC
        // nenhuma — mostrar o saldo da conta pura convidaria a um 409.
        disponivelParaCotar: !encerrada && i.status === 'aberta' ? situacao.disponivelParaCotar : 0,
      };
    }),
  };
}

const ORDEM_COMPLETA = {
  id: true,
  numero: true,
  status: true,
  condicaoPagamento: true,
  previsaoEntrega: true,
  observacao: true,
  valorTotal: true,
  motivoDevolucao: true,
  createdAt: true,
  emitidaEm: true,
  aprovadaEm: true,
  enviadaEm: true,
  fornecedor: { select: { id: true, razaoSocial: true, nomeFantasia: true, cnpj: true } },
  deposito: { select: { id: true, nome: true } },
  itens: {
    select: {
      id: true,
      quantidade: true,
      quantidadeRecebida: true,
      valorUnit: true,
      peca: { select: PECA_RESUMIDA },
      origens: {
        select: {
          id: true,
          quantidade: true,
          quantidadeRecebida: true,
          solicitacaoCompraItemId: true,
          solicitacaoCompraItem: {
            select: {
              solicitacao: {
                select: { id: true, numero: true, prioridade: true, serviceOrder: { select: { id: true, protocolo: true } } },
              },
            },
          },
        },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      },
    },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  },
} satisfies Prisma.OrdemCompraSelect;
type OrdemCompleta = Prisma.OrdemCompraGetPayload<{ select: typeof ORDEM_COMPLETA }>;

interface ContextoDeAprovacao {
  limite: number | null;
  /** O usuário que pede é OWNER/ADMIN ou o gestor master desta empresa. */
  usuarioAprova: boolean;
}

function apresentarOrdem(oc: OrdemCompleta, contexto: ContextoDeAprovacao) {
  const valorTotal = Number(oc.valorTotal);
  return {
    id: oc.id,
    numero: oc.numero,
    status: oc.status,
    fornecedor: {
      id: oc.fornecedor.id,
      razaoSocial: oc.fornecedor.razaoSocial,
      nomeFantasia: oc.fornecedor.nomeFantasia,
      cnpj: oc.fornecedor.cnpj,
    },
    deposito: { id: oc.deposito.id, nome: oc.deposito.nome },
    condicaoPagamento: oc.condicaoPagamento,
    previsaoEntrega: oc.previsaoEntrega,
    observacao: oc.observacao,
    valorTotal,
    motivoDevolucao: oc.motivoDevolucao,
    createdAt: oc.createdAt,
    emitidaEm: oc.emitidaEm,
    aprovadaEm: oc.aprovadaEm,
    enviadaEm: oc.enviadaEm,
    exigeAprovacao: exigeAprovacao(valorTotal, contexto.limite),
    // O botão só faz sentido onde o ato é possível: capacidade do usuário E
    // ordem esperando aprovação.
    podeAprovar: contexto.usuarioAprova && oc.status === 'aguardando_aprovacao',
    itens: oc.itens.map((i) => ({
      id: i.id,
      peca: { id: i.peca.id, codigoInterno: i.peca.codigoInterno, descricao: i.peca.descricao, unidade: i.peca.unidade },
      quantidade: Number(i.quantidade),
      quantidadeRecebida: Number(i.quantidadeRecebida),
      valorUnit: Number(i.valorUnit),
      origens: i.origens.map((o) => {
        const sc = o.solicitacaoCompraItem.solicitacao;
        return {
          id: o.id,
          quantidade: Number(o.quantidade),
          quantidadeRecebida: Number(o.quantidadeRecebida),
          solicitacaoCompraItemId: o.solicitacaoCompraItemId,
          solicitacao: { id: sc.id, numero: sc.numero, prioridade: sc.prioridade },
          serviceOrder: sc.serviceOrder ? { id: sc.serviceOrder.id, protocolo: sc.serviceOrder.protocolo } : null,
        };
      }),
    })),
  };
}

/** O que um ato sobre a OC precisa saber dela, relido com a OC travada. */
const ORDEM_PARA_ATO = {
  id: true,
  numero: true,
  status: true,
  partnerId: true,
  depositoId: true,
  valorTotal: true,
  criadaPorCompanyUserId: true,
  fornecedor: { select: { razaoSocial: true, nomeFantasia: true } },
  itens: {
    select: {
      pecaId: true,
      quantidade: true,
      quantidadeRecebida: true,
      valorUnit: true,
      origens: {
        select: {
          solicitacaoCompraItemId: true,
          solicitacaoCompraItem: {
            select: { solicitacaoId: true, requisicaoItem: { select: { requisicaoId: true } } },
          },
        },
      },
    },
  },
} satisfies Prisma.OrdemCompraSelect;
type OrdemParaAto = Prisma.OrdemCompraGetPayload<{ select: typeof ORDEM_PARA_ATO }>;

/** Quem uma OC alcança — o que é preciso travar para mexer na cobertura dela. */
interface AlcanceDaOrdem {
  /** As requisições das faltas cobertas (origens → item de SC → item de requisição). */
  requisicoes: string[];
  itensDeSolicitacao: string[];
  solicitacoes: string[];
}

function alcanceDaOrdem(oc: OrdemParaAto): AlcanceDaOrdem {
  const origens = oc.itens.flatMap((i) => i.origens);
  return {
    requisicoes: distintos(origens.map((o) => o.solicitacaoCompraItem.requisicaoItem?.requisicaoId)),
    itensDeSolicitacao: distintos(origens.map((o) => o.solicitacaoCompraItemId)),
    solicitacoes: distintos(origens.map((o) => o.solicitacaoCompraItem.solicitacaoId)),
  };
}

function pendenteDoItem(item: { quantidade: Prisma.Decimal; quantidadeRecebida: Prisma.Decimal }): number {
  return Math.max(0, milesimos(Number(item.quantidade)) - milesimos(Number(item.quantidadeRecebida))) / 1000;
}

@Injectable()
export class ComprasService {
  constructor(private readonly prisma: PrismaService) {}

  // --- Solicitações ----------------------------------------------------------

  /**
   * A fila de Compras, na ordem do §8: prioridade, a necessidade mais urgente
   * dos itens, e quem pediu antes.
   *
   * Duas leituras porque a segunda chave da fila (a menor `dataNecessidade`
   * dos itens) não é coluna — o banco não ordena por ela, e cortar as 200
   * primeiras numa ordem que não é a da fila deixaria de fora quem devia estar
   * no topo. A primeira leitura traz só o que decide a ordem; a segunda, a
   * forma completa das escolhidas.
   */
  async listarSolicitacoes(companyId: string, status?: string) {
    if (status && !(STATUS_SOLICITACAO as readonly string[]).includes(status)) {
      throw new BadRequestException(`Status de solicitação desconhecido: ${status}`);
    }
    const filtroDeStatus = status ? status : { in: SOLICITACAO_NA_FILA };

    const fila = await this.prisma.solicitacaoCompra.findMany({
      where: { companyId, status: filtroDeStatus },
      select: { id: true, prioridade: true, createdAt: true, itens: { select: { dataNecessidade: true } } },
    });
    const escolhidas = fila
      .map((sc) => ({
        id: sc.id,
        prioridade: sc.prioridade,
        pedidoEm: sc.createdAt,
        dataNecessidade: menorData(sc.itens.map((i) => i.dataNecessidade)),
      }))
      .sort(compararLugarNaFila)
      .slice(0, LIMITE_DA_LISTAGEM);
    if (escolhidas.length === 0) return [];

    const completas = await this.prisma.solicitacaoCompra.findMany({
      where: { companyId, status: filtroDeStatus, id: { in: escolhidas.map((e) => e.id) } },
      select: SOLICITACAO_COMPLETA,
    });
    const porId = new Map(completas.map((sc) => [sc.id, sc]));
    return escolhidas.flatMap((e) => {
      const sc = porId.get(e.id);
      return sc ? [apresentarSolicitacao(sc)] : [];
    });
  }

  async detalharSolicitacao(companyId: string, solicitacaoId: string) {
    const sc = await this.prisma.solicitacaoCompra.findFirst({
      where: { id: solicitacaoId, companyId },
      select: SOLICITACAO_COMPLETA,
    });
    if (!sc) throw new NotFoundException('Solicitação de compra não encontrada para esta empresa.');
    return apresentarSolicitacao(sc);
  }

  /** Solicitação manual: alguém do painel pede peça sem OS por trás. */
  async criarSolicitacao(input: {
    companyId: string;
    autorCompanyUserId: string;
    depositoId: string;
    prioridade: string;
    justificativa: string;
    itens: Array<{ pecaId: string; quantidade: number }>;
  }): Promise<{ id: string; numero: string }> {
    const justificativa = textoObrigatorio(input.justificativa, 'A justificativa');
    if (!(PRIORIDADES_MANUAIS as readonly string[]).includes(input.prioridade)) {
      throw new BadRequestException(`Prioridade inválida para solicitação manual: ${input.prioridade}`);
    }
    if (!input.itens?.length) throw new BadRequestException('A solicitação precisa de pelo menos um item.');
    const pecas = new Set<string>();
    for (const item of input.itens) {
      if (pecas.has(item.pecaId)) {
        throw new BadRequestException(`Peça ${item.pecaId} repetida — some as quantidades numa linha só.`);
      }
      pecas.add(item.pecaId);
      if (!(milesimos(item.quantidade) > 0)) {
        throw new BadRequestException(`Quantidade inválida para a peça ${item.pecaId}.`);
      }
    }

    // Depósito e peças da empresa e ativos, antes da transação: um id de outra
    // empresa não pode virar item de solicitação, e um id inexistente estouraria
    // a FK no meio da transação como 500.
    await this.validarDeposito(input.companyId, input.depositoId);
    const encontradas = await this.prisma.peca.findMany({
      where: { companyId: input.companyId, ativo: true, id: { in: [...pecas] } },
      select: { id: true },
    });
    const ativas = new Set(encontradas.map((p) => p.id));
    const faltando = [...pecas].filter((id) => !ativas.has(id));
    if (faltando.length > 0) {
      throw new BadRequestException(`Peça não encontrada ou inativa nesta empresa: ${faltando.join(', ')}.`);
    }

    // O número é MAX+1 e o índice único de (company_id, numero) só DETECTA a
    // colisão — `comRetryDeContencao` reconhece o P2002 de número e refaz a
    // transação inteira, recalculando o número.
    return comRetryDeContencao('a criação da solicitação de compra', () =>
      this.prisma.$transaction(async (tx) => {
        const numero = await this.proximoNumero(tx, input.companyId, 'SC');
        const sc = await tx.solicitacaoCompra.create({
          data: {
            companyId: input.companyId,
            numero,
            origem: 'manual',
            status: 'pendente',
            prioridade: input.prioridade,
            depositoId: input.depositoId,
            justificativa,
            solicitanteCompanyUserId: input.autorCompanyUserId,
            itens: {
              create: input.itens.map((i) => ({
                pecaId: i.pecaId,
                quantidade: i.quantidade,
                requisicaoItemId: null,
                prioridade: input.prioridade,
              })),
            },
          },
          select: { id: true, numero: true },
        });
        await registrarAuditoriaSuprimentos(tx, {
          companyId: input.companyId,
          acao: 'solicitacao_compra.criar',
          alvoTipo: 'suprimentos.solicitacao_compra',
          alvoId: sc.id,
          atorCompanyUserId: input.autorCompanyUserId,
          depois: {
            numero: sc.numero,
            origem: 'manual',
            prioridade: input.prioridade,
            depositoId: input.depositoId,
            itens: input.itens.map((i) => ({ pecaId: i.pecaId, quantidade: i.quantidade })),
          },
        });
        return { id: sc.id, numero: sc.numero };
      }),
    );
  }

  async rejeitarSolicitacao(input: {
    companyId: string;
    solicitacaoId: string;
    autorCompanyUserId: string;
    motivo: string;
  }) {
    return this.encerrarSolicitacao(input, 'rejeitar');
  }

  async cancelarSolicitacao(input: {
    companyId: string;
    solicitacaoId: string;
    autorCompanyUserId: string;
    motivo: string;
  }) {
    return this.encerrarSolicitacao(input, 'cancelar');
  }

  /**
   * Rejeitar (a necessidade não procede) e cancelar (deixou de existir) têm a
   * mesma mecânica: só solicitação de origem `manual`/`estoque_minimo`, só
   * `pendente`/`em_cotacao`, e só sem nenhuma unidade em OC viva — tirar do
   * radar uma necessidade que já está numa cotação ou comprada deixaria a
   * ordem de compra atendendo algo que não existe mais.
   */
  private async encerrarSolicitacao(
    input: { companyId: string; solicitacaoId: string; autorCompanyUserId: string; motivo: string },
    ato: 'rejeitar' | 'cancelar',
  ) {
    const motivo = textoObrigatorio(input.motivo, 'O motivo');
    const estadoFinal = ato === 'rejeitar' ? 'rejeitada' : 'cancelada';

    await comRetryDeContencao(
      ato === 'rejeitar' ? 'a rejeição da solicitação de compra' : 'o cancelamento da solicitação de compra',
      () =>
        this.prisma.$transaction(async (tx) => {
          await this.travarSolicitacaoInteira(tx, input.companyId, input.solicitacaoId);
          const sc = await tx.solicitacaoCompra.findUniqueOrThrow({
            where: { id: input.solicitacaoId },
            select: {
              numero: true,
              origem: true,
              status: true,
              itens: { select: { quantidade: true, origensOc: { select: ORIGEM_COM_ORDEM } } },
            },
          });
          if (!ORIGEM_QUE_COMPRAS_ENCERRA.has(sc.origem)) {
            throw new ConflictException('Solicitação de falta de OS acompanha a requisição — cancele a requisição.');
          }
          if (!SOLICITACAO_NA_FILA.includes(sc.status)) {
            throw new ConflictException(
              `A solicitação ${sc.numero} está "${sc.status}" — só pendente ou em cotação pode ser ${estadoFinal}.`,
            );
          }

          // Origem a origem, para dizer EM QUAL ordem está: uma OC cancelada
          // não prende nada, e uma encerrada só prende o que chegou por ela.
          const ordensQuePrendem = new Set<string>();
          for (const item of sc.itens) {
            for (const origem of item.origensOc) {
              const s = situacaoDoItemDeSolicitacao(Number(item.quantidade), paraCobertura([origem]));
              if (milesimos(s.comprado) > 0 || milesimos(s.emCotacao) > 0) {
                ordensQuePrendem.add(origem.ordemCompraItem.ordemCompra.numero);
              }
            }
          }
          if (ordensQuePrendem.size > 0) {
            throw new ConflictException(
              `A solicitação ${sc.numero} tem peça na ${[...ordensQuePrendem].sort().join(', ')} — ` +
                'cancele a ordem ou tire o item dela antes.',
            );
          }

          const agora = new Date();
          const dados =
            ato === 'rejeitar'
              ? {
                  status: 'rejeitada',
                  rejeitadaEm: agora,
                  rejeitadaPorCompanyUserId: input.autorCompanyUserId,
                  motivoRejeicao: motivo,
                }
              : {
                  status: 'cancelada',
                  canceladaEm: agora,
                  canceladaPorCompanyUserId: input.autorCompanyUserId,
                  motivoCancelamento: motivo,
                };
          const transicao = await tx.solicitacaoCompra.updateMany({
            where: { id: input.solicitacaoId, companyId: input.companyId, status: sc.status },
            data: dados,
          });
          if (transicao.count === 0) {
            throw new ConflictException(
              `A solicitação ${sc.numero} mudou enquanto era ${estadoFinal} — recarregue e tente de novo.`,
            );
          }
          await tx.solicitacaoCompraItem.updateMany({
            where: { solicitacaoId: input.solicitacaoId, status: 'aberta' },
            data: { status: 'cancelada' },
          });

          await registrarAuditoriaSuprimentos(tx, {
            companyId: input.companyId,
            acao: `solicitacao_compra.${ato}`,
            alvoTipo: 'suprimentos.solicitacao_compra',
            alvoId: input.solicitacaoId,
            atorCompanyUserId: input.autorCompanyUserId,
            motivo,
            antes: { status: sc.status },
            depois: { status: estadoFinal },
          });
        }),
    );

    return this.detalharSolicitacao(input.companyId, input.solicitacaoId);
  }

  // --- Ordens de compra: leitura ---------------------------------------------

  /** Mais antiga primeiro: a lista responde "o que ainda está andando". */
  async listarOrdens(companyId: string, companyUserId: string, status?: string) {
    if (status && !(STATUS_ORDEM_COMPRA as readonly string[]).includes(status)) {
      throw new BadRequestException(`Status de ordem de compra desconhecido: ${status}`);
    }
    const ordens = await this.prisma.ordemCompra.findMany({
      where: { companyId, status: status ? status : { in: ORDEM_EM_ANDAMENTO } },
      select: ORDEM_COMPLETA,
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: LIMITE_DA_LISTAGEM,
    });
    const contexto = await this.contextoDeAprovacao(companyId, companyUserId);
    return ordens.map((oc) => apresentarOrdem(oc, contexto));
  }

  async detalharOrdem(companyId: string, companyUserId: string, ordemCompraId: string) {
    const oc = await this.prisma.ordemCompra.findFirst({
      where: { id: ordemCompraId, companyId },
      select: ORDEM_COMPLETA,
    });
    if (!oc) throw new NotFoundException('Ordem de compra não encontrada para esta empresa.');
    return apresentarOrdem(oc, await this.contextoDeAprovacao(companyId, companyUserId));
  }

  // --- Ordens de compra: cotação ---------------------------------------------

  async criarOrdem(input: {
    companyId: string;
    autorCompanyUserId: string;
    partnerId: string;
    depositoId: string;
    condicaoPagamento?: string | null;
    previsaoEntrega?: string | null;
    observacao?: string | null;
  }): Promise<{ id: string; numero: string }> {
    const previsaoEntrega = dataOpcional(input.previsaoEntrega) ?? null;
    await this.exigirFornecedor(this.prisma, input.companyId, input.partnerId, 'pedido');
    await this.validarDeposito(input.companyId, input.depositoId);

    return comRetryDeContencao('a criação da ordem de compra', () =>
      this.prisma.$transaction(async (tx) => {
        const numero = await this.proximoNumero(tx, input.companyId, 'OC');
        const oc = await tx.ordemCompra.create({
          data: {
            companyId: input.companyId,
            numero,
            status: 'rascunho',
            partnerId: input.partnerId,
            depositoId: input.depositoId,
            condicaoPagamento: textoOpcional(input.condicaoPagamento) ?? null,
            previsaoEntrega,
            observacao: textoOpcional(input.observacao) ?? null,
            criadaPorCompanyUserId: input.autorCompanyUserId,
          },
          select: { id: true, numero: true },
        });
        await registrarAuditoriaSuprimentos(tx, {
          companyId: input.companyId,
          acao: 'ordem_compra.criar',
          alvoTipo: 'suprimentos.ordem_compra',
          alvoId: oc.id,
          atorCompanyUserId: input.autorCompanyUserId,
          depois: { numero: oc.numero, status: 'rascunho', partnerId: input.partnerId, depositoId: input.depositoId },
        });
        return { id: oc.id, numero: oc.numero };
      }),
    );
  }

  async editarOrdem(input: {
    companyId: string;
    ordemCompraId: string;
    autorCompanyUserId: string;
    partnerId?: string;
    condicaoPagamento?: string | null;
    previsaoEntrega?: string | null;
    observacao?: string | null;
  }) {
    const dados: Prisma.OrdemCompraUncheckedUpdateManyInput = {};
    if (input.partnerId !== undefined) {
      await this.exigirFornecedor(this.prisma, input.companyId, input.partnerId, 'pedido');
      dados.partnerId = input.partnerId;
    }
    if (input.condicaoPagamento !== undefined) dados.condicaoPagamento = textoOpcional(input.condicaoPagamento);
    if (input.previsaoEntrega !== undefined) dados.previsaoEntrega = dataOpcional(input.previsaoEntrega);
    if (input.observacao !== undefined) dados.observacao = textoOpcional(input.observacao);
    if (Object.keys(dados).length === 0) {
      throw new BadRequestException('Informe ao menos um campo para alterar.');
    }

    await comRetryDeContencao('a edição da ordem de compra', () =>
      this.prisma.$transaction(async (tx) => {
        await this.travarOrdem(tx, input.ordemCompraId, input.companyId);
        const oc = await tx.ordemCompra.findUniqueOrThrow({
          where: { id: input.ordemCompraId },
          select: { numero: true, status: true, partnerId: true, condicaoPagamento: true, previsaoEntrega: true, observacao: true },
        });
        if (!acaoPermitida(oc.status, 'editar')) {
          throw new ConflictException(`Só ordem em rascunho é editada — a ${oc.numero} está "${oc.status}".`);
        }
        const transicao = await tx.ordemCompra.updateMany({
          where: { id: input.ordemCompraId, companyId: input.companyId, status: 'rascunho' },
          data: dados,
        });
        if (transicao.count === 0) {
          throw new ConflictException(`A ${oc.numero} mudou de estado durante a edição — recarregue e tente de novo.`);
        }
        await registrarAuditoriaSuprimentos(tx, {
          companyId: input.companyId,
          acao: 'ordem_compra.editar',
          alvoTipo: 'suprimentos.ordem_compra',
          alvoId: input.ordemCompraId,
          atorCompanyUserId: input.autorCompanyUserId,
          antes: {
            partnerId: oc.partnerId,
            condicaoPagamento: oc.condicaoPagamento,
            previsaoEntrega: oc.previsaoEntrega,
            observacao: oc.observacao,
          },
          depois: dados as Prisma.InputJsonValue,
        });
      }),
    );
    return this.detalharOrdem(input.companyId, input.autorCompanyUserId, input.ordemCompraId);
  }

  /**
   * A cotação: substitui TODOS os itens do rascunho. Uma linha por peça, com a
   * quantidade = soma das origens.
   *
   * Cotação não é compra (`situacaoDoItemDeSolicitacao` conta rascunho como
   * `emCotacao`, e `cobertura` não conta como a caminho): não mexe em saldo nem
   * em requisição, e por isso não trava requisição nem `peca_saldos`. Trava as
   * linhas de SC que entram (é o que decide a quantidade disponível) e os
   * cabeçalhos de todas as SC tocadas — as que entram e as que saem — porque o
   * estado de cada uma é recalculado aqui.
   */
  async substituirItens(input: {
    companyId: string;
    ordemCompraId: string;
    autorCompanyUserId: string;
    itens: Array<{
      pecaId: string;
      valorUnit: number;
      origens: Array<{ solicitacaoCompraItemId: string; quantidade: number }>;
    }>;
  }) {
    // A forma do pedido, sem banco. Item de SC repetido é recusado aqui porque
    // no banco ele viraria P2002 no índice `ordem_compra_item_origens_par` (ou
    // no de uma linha por peça), que não é contenção de número e subiria como 500.
    const pecasVistas = new Set<string>();
    const origensVistas = new Set<string>();
    const planejado = input.itens.map((item) => {
      if (pecasVistas.has(item.pecaId)) {
        throw new BadRequestException(`Peça ${item.pecaId} repetida — uma linha por peça; junte as origens nela.`);
      }
      pecasVistas.add(item.pecaId);
      if (!(item.valorUnit >= 0)) {
        throw new BadRequestException(`Valor unitário inválido para a peça ${item.pecaId}.`);
      }
      if (!item.origens?.length) {
        throw new BadRequestException(`A peça ${item.pecaId} está sem origem — toda linha atende algum item de solicitação.`);
      }
      let total = 0;
      for (const origem of item.origens) {
        if (origensVistas.has(origem.solicitacaoCompraItemId)) {
          throw new BadRequestException(`Item de solicitação ${origem.solicitacaoCompraItemId} repetido no pedido.`);
        }
        origensVistas.add(origem.solicitacaoCompraItemId);
        if (!(milesimos(origem.quantidade) > 0)) {
          throw new BadRequestException(`Quantidade inválida para o item de solicitação ${origem.solicitacaoCompraItemId}.`);
        }
        total += milesimos(origem.quantidade);
      }
      return { pecaId: item.pecaId, valorUnit: item.valorUnit, quantidade: total / 1000, origens: item.origens };
    });
    const idsPedidos = [...origensVistas];

    await comRetryDeContencao('a cotação da ordem de compra', () =>
      this.prisma.$transaction(async (tx) => {
        await this.travarOrdem(tx, input.ordemCompraId, input.companyId);
        const oc = await tx.ordemCompra.findUniqueOrThrow({
          where: { id: input.ordemCompraId },
          select: {
            numero: true,
            status: true,
            depositoId: true,
            valorTotal: true,
            itens: { select: { origens: { select: { solicitacaoCompraItem: { select: { solicitacaoId: true } } } } } },
          },
        });
        if (!acaoPermitida(oc.status, 'editar')) {
          throw new ConflictException(`Só ordem em rascunho tem os itens trocados — a ${oc.numero} está "${oc.status}".`);
        }

        // Só para saber o que travar: o item de SC nunca troca de cabeçalho.
        // Escopado à empresa pelo cabeçalho — item de outra empresa não aparece.
        const alvos =
          idsPedidos.length > 0
            ? await tx.solicitacaoCompraItem.findMany({
                where: { id: { in: idsPedidos }, solicitacao: { companyId: input.companyId } },
                select: { id: true, solicitacaoId: true },
              })
            : [];
        const achados = new Set(alvos.map((a) => a.id));
        const naoAchados = idsPedidos.filter((id) => !achados.has(id));
        if (naoAchados.length > 0) {
          throw new BadRequestException(`Item de solicitação não encontrado nesta empresa: ${naoAchados.join(', ')}.`);
        }
        const tocadas = distintos([
          ...alvos.map((a) => a.solicitacaoId),
          ...oc.itens.flatMap((i) => i.origens.map((o) => o.solicitacaoCompraItem.solicitacaoId)),
        ]);

        await this.travarItensDeSolicitacao(tx, idsPedidos);

        const frescos =
          idsPedidos.length > 0
            ? await tx.solicitacaoCompraItem.findMany({
                where: { id: { in: idsPedidos } },
                select: {
                  id: true,
                  pecaId: true,
                  status: true,
                  quantidade: true,
                  solicitacao: { select: { numero: true, status: true, depositoId: true } },
                  origensOc: { select: ORIGEM_COM_ORDEM },
                },
              })
            : [];
        const frescoPorId = new Map(frescos.map((f) => [f.id, f]));

        for (const linha of planejado) {
          for (const origem of linha.origens) {
            const item = frescoPorId.get(origem.solicitacaoCompraItemId);
            if (!item) {
              throw new BadRequestException(`Item de solicitação não encontrado: ${origem.solicitacaoCompraItemId}.`);
            }
            const numero = item.solicitacao.numero;
            if (SOLICITACAO_ENCERRADA.has(item.solicitacao.status)) {
              throw new ConflictException(`A solicitação ${numero} foi ${item.solicitacao.status} — não entra em cotação.`);
            }
            if (item.status !== 'aberta') {
              throw new ConflictException(`O item da solicitação ${numero} está "${item.status}" — não entra em cotação.`);
            }
            if (item.pecaId !== linha.pecaId) {
              throw new BadRequestException(`O item ${item.id} da solicitação ${numero} é de outra peça.`);
            }
            if (item.solicitacao.depositoId !== oc.depositoId) {
              throw new BadRequestException(
                `A solicitação ${numero} é de outro depósito — uma ordem de compra atende um depósito só.`,
              );
            }
            // As origens DESTA ordem estão sendo substituídas: contá-las como
            // cotação faria o mesmo rascunho, salvo de novo, recusar a si mesmo.
            const deOutrasOrdens = item.origensOc.filter((o) => o.ordemCompraItem.ordemCompraId !== input.ordemCompraId);
            const { disponivelParaCotar } = situacaoDoItemDeSolicitacao(
              Number(item.quantidade),
              paraCobertura(deOutrasOrdens),
            );
            if (milesimos(origem.quantidade) > milesimos(disponivelParaCotar)) {
              throw new ConflictException(
                `A solicitação ${numero} tem ${disponivelParaCotar} disponível para cotar — o pedido foi de ${origem.quantidade}.`,
              );
            }
          }
        }

        await tx.ordemCompraItem.deleteMany({ where: { ordemCompraId: input.ordemCompraId } });
        for (const linha of planejado) {
          await tx.ordemCompraItem.create({
            data: {
              ordemCompraId: input.ordemCompraId,
              pecaId: linha.pecaId,
              quantidade: linha.quantidade,
              valorUnit: linha.valorUnit,
              origens: {
                create: linha.origens.map((o) => ({
                  solicitacaoCompraItemId: o.solicitacaoCompraItemId,
                  quantidade: o.quantidade,
                })),
              },
            },
            select: { id: true },
          });
        }

        const valorTotal = valorTotalDaOrdem(planejado);
        const gravada = await tx.ordemCompra.updateMany({
          where: { id: input.ordemCompraId, companyId: input.companyId, status: 'rascunho' },
          data: { valorTotal },
        });
        if (gravada.count === 0) {
          throw new ConflictException(`A ${oc.numero} mudou de estado durante a cotação — recarregue e tente de novo.`);
        }

        await this.recalcularSolicitacoes(tx, input.companyId, tocadas);

        await registrarAuditoriaSuprimentos(tx, {
          companyId: input.companyId,
          acao: 'ordem_compra.cotar',
          alvoTipo: 'suprimentos.ordem_compra',
          alvoId: input.ordemCompraId,
          atorCompanyUserId: input.autorCompanyUserId,
          antes: { valorTotal: Number(oc.valorTotal), itens: oc.itens.length },
          depois: {
            valorTotal,
            itens: planejado.map((p) => ({
              pecaId: p.pecaId,
              quantidade: p.quantidade,
              valorUnit: p.valorUnit,
              origens: p.origens.map((o) => ({ solicitacaoCompraItemId: o.solicitacaoCompraItemId, quantidade: o.quantidade })),
            })),
          },
        });
      }),
    );
    return this.detalharOrdem(input.companyId, input.autorCompanyUserId, input.ordemCompraId);
  }

  // --- Ordens de compra: aprovação e emissão ---------------------------------

  /**
   * Fecha a cotação. A aprovação por valor mora aqui: dentro do limite a ordem
   * é emitida na hora; acima dele (ou sem limite configurado) espera OWNER/ADMIN
   * ou o gestor master.
   *
   * O limite é comparado com o TOTAL da ordem: juntar três solicitações de
   * R$ 400 numa OC de R$ 1.200 com limite de R$ 1.000 pede aprovação — o
   * fracionamento não escapa.
   */
  async confirmarOrdem(input: { companyId: string; ordemCompraId: string; autorCompanyUserId: string }) {
    const { notificacoes } = await comRetryDeContencao('a confirmação da ordem de compra', () =>
      this.prisma.$transaction(async (tx) => {
        await this.travarOrdem(tx, input.ordemCompraId, input.companyId);
        const oc = await this.lerOrdemParaAto(tx, input.ordemCompraId);
        if (!acaoPermitida(oc.status, 'confirmar')) {
          throw new ConflictException(`Só ordem em rascunho é confirmada — a ${oc.numero} está "${oc.status}".`);
        }
        if (oc.itens.length === 0) {
          throw new ConflictException(`A ${oc.numero} não tem itens — monte a cotação antes de confirmar.`);
        }
        await this.exigirFornecedor(tx, input.companyId, oc.partnerId, 'estado');

        const valorTotal = valorTotalDaOrdem(
          oc.itens.map((i) => ({ quantidade: Number(i.quantidade), valorUnit: Number(i.valorUnit) })),
        );
        const config = await tx.companySettings.findUnique({
          where: { companyId: input.companyId },
          select: { comprasLimiteAprovacao: true, gestorMasterCompanyUserId: true },
        });
        const limite = limiteDe(config);

        if (!exigeAprovacao(valorTotal, limite)) {
          await this.emitir(tx, {
            companyId: input.companyId,
            oc,
            statusDeOrigem: 'rascunho',
            valorTotal,
            autorCompanyUserId: input.autorCompanyUserId,
            aprovacao: false,
          });
          await registrarAuditoriaSuprimentos(tx, {
            companyId: input.companyId,
            acao: 'ordem_compra.emitir',
            alvoTipo: 'suprimentos.ordem_compra',
            alvoId: oc.id,
            atorCompanyUserId: input.autorCompanyUserId,
            antes: { status: oc.status },
            depois: { status: 'emitida', valorTotal, limite },
          });
          return { notificacoes: [] as NotificacaoPronta[] };
        }

        // Rascunho → aguardando aprovação não muda o estado de SC nenhuma (as
        // duas são cotação para `situacaoDoItemDeSolicitacao`) nem a cobertura
        // de falta nenhuma — por isso nem requisição, nem saldo, nem cabeçalho
        // de SC. As linhas de SC são travadas só para a checagem de que
        // continuam abertas valer.
        const alcance = alcanceDaOrdem(oc);
        await this.travarItensDeSolicitacao(tx, alcance.itensDeSolicitacao);
        await this.exigirOrigensVivas(tx, alcance.itensDeSolicitacao);

        const transicao = await tx.ordemCompra.updateMany({
          where: { id: oc.id, companyId: input.companyId, status: 'rascunho' },
          data: { status: 'aguardando_aprovacao', valorTotal },
        });
        if (transicao.count === 0) {
          throw new ConflictException(`A ${oc.numero} mudou de estado durante a confirmação — recarregue e tente de novo.`);
        }
        await registrarAuditoriaSuprimentos(tx, {
          companyId: input.companyId,
          acao: 'ordem_compra.confirmar',
          alvoTipo: 'suprimentos.ordem_compra',
          alvoId: oc.id,
          atorCompanyUserId: input.autorCompanyUserId,
          antes: { status: oc.status },
          depois: { status: 'aguardando_aprovacao', valorTotal, limite },
        });
        const avisos = await montarNotificacaoAguardandoAprovacao(tx, {
          companyId: input.companyId,
          ordemCompraId: oc.id,
          numero: oc.numero,
          fornecedor: oc.fornecedor.nomeFantasia ?? oc.fornecedor.razaoSocial,
          valorTotal,
          limite,
          gestorMasterCompanyUserId: config?.gestorMasterCompanyUserId ?? null,
        });
        return { notificacoes: avisos };
      }),
    );
    // Depois do commit e do laço de retry, com o client normal — nunca `tx`.
    await enviarNotificacoes(this.prisma, notificacoes);
    return this.detalharOrdem(input.companyId, input.autorCompanyUserId, input.ordemCompraId);
  }

  async aprovarOrdem(input: { companyId: string; ordemCompraId: string; autorCompanyUserId: string }) {
    await comRetryDeContencao('a aprovação da ordem de compra', () =>
      this.prisma.$transaction(async (tx) => {
        await this.travarOrdem(tx, input.ordemCompraId, input.companyId);
        await this.exigirAprovador(
          tx,
          input.companyId,
          input.autorCompanyUserId,
          'Só OWNER/ADMIN ou o gestor master aprovam ordem de compra acima do limite.',
        );
        const oc = await this.lerOrdemParaAto(tx, input.ordemCompraId);
        if (!acaoPermitida(oc.status, 'aprovar')) {
          throw new ConflictException(`Só ordem aguardando aprovação é aprovada — a ${oc.numero} está "${oc.status}".`);
        }
        // O fornecedor pode ter sido desativado enquanto a ordem esperava.
        await this.exigirFornecedor(tx, input.companyId, oc.partnerId, 'estado');
        const valorTotal = valorTotalDaOrdem(
          oc.itens.map((i) => ({ quantidade: Number(i.quantidade), valorUnit: Number(i.valorUnit) })),
        );
        await this.emitir(tx, {
          companyId: input.companyId,
          oc,
          statusDeOrigem: 'aguardando_aprovacao',
          valorTotal,
          autorCompanyUserId: input.autorCompanyUserId,
          aprovacao: true,
        });
        await registrarAuditoriaSuprimentos(tx, {
          companyId: input.companyId,
          acao: 'ordem_compra.aprovar',
          alvoTipo: 'suprimentos.ordem_compra',
          alvoId: oc.id,
          atorCompanyUserId: input.autorCompanyUserId,
          antes: { status: oc.status },
          depois: { status: 'emitida', valorTotal },
        });
      }),
    );
    return this.detalharOrdem(input.companyId, input.autorCompanyUserId, input.ordemCompraId);
  }

  async devolverOrdem(input: {
    companyId: string;
    ordemCompraId: string;
    autorCompanyUserId: string;
    motivo: string;
  }) {
    const motivo = textoObrigatorio(input.motivo, 'O motivo');
    const { notificacoes } = await comRetryDeContencao('a devolução da ordem de compra', () =>
      this.prisma.$transaction(async (tx) => {
        await this.travarOrdem(tx, input.ordemCompraId, input.companyId);
        await this.exigirAprovador(
          tx,
          input.companyId,
          input.autorCompanyUserId,
          'Só OWNER/ADMIN ou o gestor master devolvem ordem de compra em aprovação.',
        );
        const oc = await tx.ordemCompra.findUniqueOrThrow({
          where: { id: input.ordemCompraId },
          select: { id: true, numero: true, status: true, criadaPorCompanyUserId: true },
        });
        if (!acaoPermitida(oc.status, 'devolver')) {
          throw new ConflictException(`Só ordem aguardando aprovação é devolvida — a ${oc.numero} está "${oc.status}".`);
        }
        // Aguardando aprovação → rascunho: continua cotação para as SC e para a
        // cobertura, então nada além da própria ordem muda.
        const transicao = await tx.ordemCompra.updateMany({
          where: { id: oc.id, companyId: input.companyId, status: 'aguardando_aprovacao' },
          data: {
            status: 'rascunho',
            devolvidaEm: new Date(),
            devolvidaPorCompanyUserId: input.autorCompanyUserId,
            motivoDevolucao: motivo,
          },
        });
        if (transicao.count === 0) {
          throw new ConflictException(`A ${oc.numero} mudou de estado durante a devolução — recarregue e tente de novo.`);
        }
        await registrarAuditoriaSuprimentos(tx, {
          companyId: input.companyId,
          acao: 'ordem_compra.devolver',
          alvoTipo: 'suprimentos.ordem_compra',
          alvoId: oc.id,
          atorCompanyUserId: input.autorCompanyUserId,
          motivo,
          antes: { status: oc.status },
          depois: { status: 'rascunho' },
        });
        const avisos = await montarNotificacaoOrdemDevolvida(tx, {
          companyId: input.companyId,
          ordemCompraId: oc.id,
          numero: oc.numero,
          motivo,
          criadaPorCompanyUserId: oc.criadaPorCompanyUserId,
        });
        return { notificacoes: avisos };
      }),
    );
    await enviarNotificacoes(this.prisma, notificacoes);
    return this.detalharOrdem(input.companyId, input.autorCompanyUserId, input.ordemCompraId);
  }

  // --- Ordens de compra: depois de emitida -----------------------------------

  /**
   * Emitida → enviada. Não mexe em saldo nem em cobertura: as duas contam como
   * compra a caminho em `cobertura` e em `situacaoDoItemDeSolicitacao`.
   */
  async enviarOrdem(input: { companyId: string; ordemCompraId: string; autorCompanyUserId: string }) {
    await comRetryDeContencao('o envio da ordem de compra', () =>
      this.prisma.$transaction(async (tx) => {
        await this.travarOrdem(tx, input.ordemCompraId, input.companyId);
        const oc = await tx.ordemCompra.findUniqueOrThrow({
          where: { id: input.ordemCompraId },
          select: { id: true, numero: true, status: true },
        });
        if (!acaoPermitida(oc.status, 'enviar')) {
          throw new ConflictException(`Só ordem emitida é enviada ao fornecedor — a ${oc.numero} está "${oc.status}".`);
        }
        const transicao = await tx.ordemCompra.updateMany({
          where: { id: oc.id, companyId: input.companyId, status: 'emitida' },
          data: { status: 'enviada', enviadaEm: new Date(), enviadaPorCompanyUserId: input.autorCompanyUserId },
        });
        if (transicao.count === 0) {
          throw new ConflictException(`A ${oc.numero} mudou de estado durante o envio — recarregue e tente de novo.`);
        }
        await registrarAuditoriaSuprimentos(tx, {
          companyId: input.companyId,
          acao: 'ordem_compra.enviar',
          alvoTipo: 'suprimentos.ordem_compra',
          alvoId: oc.id,
          atorCompanyUserId: input.autorCompanyUserId,
          antes: { status: oc.status },
          depois: { status: 'enviada' },
        });
      }),
    );
    return this.detalharOrdem(input.companyId, input.autorCompanyUserId, input.ordemCompraId);
  }

  /**
   * Cancela uma ordem que ainda não recebeu nada. Se já estava emitida (ou
   * enviada), a compra deixa de estar a caminho: o `saldo_em_compra` desce pelo
   * pendente e a falta das OS volta a ficar sem cobertura.
   */
  async cancelarOrdem(input: {
    companyId: string;
    ordemCompraId: string;
    autorCompanyUserId: string;
    motivo: string;
  }) {
    const motivo = textoObrigatorio(input.motivo, 'O motivo');
    await comRetryDeContencao('o cancelamento da ordem de compra', () =>
      this.prisma.$transaction(async (tx) => {
        await this.travarOrdem(tx, input.ordemCompraId, input.companyId);
        const oc = await this.lerOrdemParaAto(tx, input.ordemCompraId);
        if (!acaoPermitida(oc.status, 'cancelar')) {
          throw new ConflictException(
            oc.status === 'recebida_parcial'
              ? `A ${oc.numero} já recebeu peça — encerre a ordem em vez de cancelar.`
              : `A ${oc.numero} está "${oc.status}" e não pode ser cancelada.`,
          );
        }
        const agora = new Date();
        await this.fecharOrdem(tx, {
          companyId: input.companyId,
          oc,
          devolveCompromisso: oc.status === 'emitida' || oc.status === 'enviada',
          dados: {
            status: 'cancelada',
            canceladaEm: agora,
            canceladaPorCompanyUserId: input.autorCompanyUserId,
            motivoCancelamento: motivo,
          },
        });
        await registrarAuditoriaSuprimentos(tx, {
          companyId: input.companyId,
          acao: 'ordem_compra.cancelar',
          alvoTipo: 'suprimentos.ordem_compra',
          alvoId: oc.id,
          atorCompanyUserId: input.autorCompanyUserId,
          motivo,
          antes: { status: oc.status },
          depois: { status: 'cancelada' },
        });
      }),
    );
    return this.detalharOrdem(input.companyId, input.autorCompanyUserId, input.ordemCompraId);
  }

  /**
   * Recebeu parte e o resto não vem. Só o PENDENTE (`quantidade −
   * quantidadeRecebida`) sai do `saldo_em_compra` — o que chegou já saiu dele no
   * recebimento — e a parte que não vem volta a ser falta sem cobertura.
   */
  async encerrarOrdem(input: {
    companyId: string;
    ordemCompraId: string;
    autorCompanyUserId: string;
    motivo: string;
  }) {
    const motivo = textoObrigatorio(input.motivo, 'O motivo');
    await comRetryDeContencao('o encerramento da ordem de compra', () =>
      this.prisma.$transaction(async (tx) => {
        await this.travarOrdem(tx, input.ordemCompraId, input.companyId);
        const oc = await this.lerOrdemParaAto(tx, input.ordemCompraId);
        if (!acaoPermitida(oc.status, 'encerrar')) {
          throw new ConflictException(
            `Só ordem com recebimento parcial é encerrada — a ${oc.numero} está "${oc.status}".`,
          );
        }
        await this.fecharOrdem(tx, {
          companyId: input.companyId,
          oc,
          devolveCompromisso: true,
          dados: {
            status: 'encerrada',
            encerradaEm: new Date(),
            encerradaPorCompanyUserId: input.autorCompanyUserId,
            motivoEncerramento: motivo,
          },
        });
        await registrarAuditoriaSuprimentos(tx, {
          companyId: input.companyId,
          acao: 'ordem_compra.encerrar',
          alvoTipo: 'suprimentos.ordem_compra',
          alvoId: oc.id,
          atorCompanyUserId: input.autorCompanyUserId,
          motivo,
          antes: { status: oc.status },
          depois: { status: 'encerrada' },
        });
      }),
    );
    return this.detalharOrdem(input.companyId, input.autorCompanyUserId, input.ordemCompraId);
  }

  // --- Motor --------------------------------------------------------------

  /**
   * EMITIR: a ordem vira compromisso. Roda dentro da transação do ato que a
   * chama (confirmar ou aprovar), com a OC já travada e relida.
   *
   * Emitir muda a cobertura das faltas cobertas (`cobertura` passa a contar a
   * ordem como a caminho), e é por isso que as requisições delas são travadas
   * antes de tudo — `recalcularStatusDeCompraDaOs` só lê com confiança o que
   * está sob a trava da requisição.
   */
  private async emitir(
    tx: Prisma.TransactionClient,
    input: {
      companyId: string;
      oc: OrdemParaAto;
      statusDeOrigem: 'rascunho' | 'aguardando_aprovacao';
      valorTotal: number;
      autorCompanyUserId: string;
      aprovacao: boolean;
    },
  ): Promise<void> {
    const alcance = alcanceDaOrdem(input.oc);
    for (const requisicaoId of alcance.requisicoes) {
      await travarRequisicao(tx, requisicaoId, input.companyId);
    }
    await this.travarItensDeSolicitacao(tx, alcance.itensDeSolicitacao);
    // Um item pode ter sido cancelado desde a cotação — pelo cancelamento da
    // requisição (`cancelarSolicitacoesDasFaltas`), que não mexe na OC.
    await this.exigirOrigensVivas(tx, alcance.itensDeSolicitacao);

    const agora = new Date();
    const transicao = await tx.ordemCompra.updateMany({
      where: { id: input.oc.id, companyId: input.companyId, status: input.statusDeOrigem },
      data: {
        status: 'emitida',
        valorTotal: input.valorTotal,
        emitidaEm: agora,
        emitidaPorCompanyUserId: input.autorCompanyUserId,
        ...(input.aprovacao ? { aprovadaEm: agora, aprovadaPorCompanyUserId: input.autorCompanyUserId } : {}),
      },
    });
    if (transicao.count === 0) {
      throw new ConflictException(`A ${input.oc.numero} mudou de estado durante a emissão — recarregue e tente de novo.`);
    }

    await this.moverSaldoEmCompra(
      tx,
      input.oc.depositoId,
      input.oc.itens.map((i) => ({ pecaId: i.pecaId, quantidade: Number(i.quantidade) })),
      'somar',
    );
    // Depois da transição (os dois recálculos leem o status da OC do banco) e
    // do saldo (o cabeçalho da SC vem depois de `peca_saldos` na ordem de trava).
    await this.recalcularSolicitacoes(tx, input.companyId, alcance.solicitacoes);
    for (const requisicaoId of alcance.requisicoes) {
      await recalcularStatusDeCompraDaOs(tx, { requisicaoId, companyId: input.companyId });
    }
  }

  /**
   * Cancelar ou encerrar. Com `devolveCompromisso` (a ordem estava emitida,
   * enviada ou com recebimento parcial), faz as mesmas travas da emissão e
   * devolve o pendente de cada item ao `saldo_em_compra`; sem ele (rascunho ou
   * aguardando aprovação) só o estado da OC e o das SC mudam.
   */
  private async fecharOrdem(
    tx: Prisma.TransactionClient,
    input: {
      companyId: string;
      oc: OrdemParaAto;
      devolveCompromisso: boolean;
      dados: Prisma.OrdemCompraUncheckedUpdateManyInput;
    },
  ): Promise<void> {
    const alcance = alcanceDaOrdem(input.oc);
    if (input.devolveCompromisso) {
      for (const requisicaoId of alcance.requisicoes) {
        await travarRequisicao(tx, requisicaoId, input.companyId);
      }
    }
    await this.travarItensDeSolicitacao(tx, alcance.itensDeSolicitacao);

    const transicao = await tx.ordemCompra.updateMany({
      where: { id: input.oc.id, companyId: input.companyId, status: input.oc.status },
      data: input.dados,
    });
    if (transicao.count === 0) {
      throw new ConflictException(`A ${input.oc.numero} mudou de estado durante este ato — recarregue e tente de novo.`);
    }

    if (input.devolveCompromisso) {
      // O pendente vem de `input.oc`, relido depois da trava da OC — é quem
      // serializa o recebimento, que é o único que muda `quantidadeRecebida`.
      await this.moverSaldoEmCompra(
        tx,
        input.oc.depositoId,
        input.oc.itens.map((i) => ({ pecaId: i.pecaId, quantidade: pendenteDoItem(i) })),
        'subtrair',
      );
    }
    await this.recalcularSolicitacoes(tx, input.companyId, alcance.solicitacoes);
    if (input.devolveCompromisso) {
      for (const requisicaoId of alcance.requisicoes) {
        await recalcularStatusDeCompraDaOs(tx, { requisicaoId, companyId: input.companyId });
      }
    }
  }

  /**
   * `saldo_em_compra` sobe na emissão e desce no cancelamento e no
   * encerramento. Aritmética RELATIVA no SQL, sob a trava da linha — nunca
   * "leia, some em JS, grave absoluto".
   *
   * `FOR UPDATE` não trava linha que não existe, e a peça pode nunca ter tido
   * saldo neste depósito (compra de peça nova). Por isso o `upsert` com
   * `update: {}` antes, como em `darEntrada`: garante a linha sem mexer no que
   * já existe, e só então trava.
   *
   * O CHECK `peca_saldos_em_compra_valido` (`saldo_em_compra >= 0`) é a rede:
   * descer mais do que subiu é erro de conta, e o banco o recusa.
   */
  private async moverSaldoEmCompra(
    tx: Prisma.TransactionClient,
    depositoId: string,
    linhas: Array<{ pecaId: string; quantidade: number }>,
    operacao: 'somar' | 'subtrair',
  ): Promise<void> {
    const porPeca = new Map<string, number>();
    for (const l of linhas) porPeca.set(l.pecaId, (porPeca.get(l.pecaId) ?? 0) + milesimos(l.quantidade));

    for (const pecaId of [...porPeca.keys()].sort(compararPorPeca)) {
      await tx.pecaSaldo.upsert({
        where: { pecaId_depositoId: { pecaId, depositoId } },
        create: { pecaId, depositoId },
        update: {},
      });
      const travada = await tx.$queryRaw<{ saldo_em_compra: string }[]>(Prisma.sql`
        SELECT saldo_em_compra FROM peca_saldos
         WHERE peca_id = ${pecaId}::uuid
           AND deposito_id = ${depositoId}::uuid
           FOR UPDATE
      `);
      if (!travada[0]) {
        throw new Error(`Saldo não encontrado para peça ${pecaId} no depósito ${depositoId} logo depois de garantir a linha.`);
      }

      const quantidade = (porPeca.get(pecaId) ?? 0) / 1000;
      if (quantidade <= 0) continue;
      if (operacao === 'somar') {
        await tx.$executeRaw(Prisma.sql`
          UPDATE peca_saldos
             SET saldo_em_compra = saldo_em_compra + ${quantidade}, updated_at = now()
           WHERE peca_id = ${pecaId}::uuid
             AND deposito_id = ${depositoId}::uuid
        `);
      } else {
        await tx.$executeRaw(Prisma.sql`
          UPDATE peca_saldos
             SET saldo_em_compra = saldo_em_compra - ${quantidade}, updated_at = now()
           WHERE peca_id = ${pecaId}::uuid
             AND deposito_id = ${depositoId}::uuid
        `);
      }
    }
  }

  /**
   * Trava os cabeçalhos das SC tocadas e recalcula o estado de cada uma com
   * `recalcularEstadoDaSolicitacao` — a mesma função do recebimento, para a
   * regra do cabeçalho morar num lugar só. A trava vem logo antes: com ela na
   * mão, o estado lido e gravado lá dentro é o que vale, e todo outro escritor
   * do cabeçalho espera por ela.
   */
  private async recalcularSolicitacoes(
    tx: Prisma.TransactionClient,
    companyId: string,
    solicitacaoIds: string[],
  ): Promise<void> {
    const ids = distintos(solicitacaoIds);
    await this.travarCabecalhosDeSolicitacao(tx, companyId, ids);
    for (const id of ids) {
      await recalcularEstadoDaSolicitacao(tx, id);
    }
  }

  /** Todo item de SC das origens ainda `aberta`, com o cabeçalho vivo. */
  private async exigirOrigensVivas(tx: Prisma.TransactionClient, itemIds: string[]): Promise<void> {
    if (itemIds.length === 0) return;
    const itens = await tx.solicitacaoCompraItem.findMany({
      where: { id: { in: itemIds } },
      select: { id: true, status: true, solicitacao: { select: { numero: true, status: true } } },
    });
    const porId = new Map(itens.map((i) => [i.id, i]));
    for (const id of itemIds) {
      const item = porId.get(id);
      if (!item) {
        throw new ConflictException('Um item de solicitação desta ordem não existe mais — revise a cotação.');
      }
      if (SOLICITACAO_ENCERRADA.has(item.solicitacao.status)) {
        throw new ConflictException(
          `A solicitação ${item.solicitacao.numero} foi ${item.solicitacao.status} — tire os itens dela da ordem antes de seguir.`,
        );
      }
      if (item.status !== 'aberta') {
        throw new ConflictException(
          `O item da solicitação ${item.solicitacao.numero} está "${item.status}" — tire-o da ordem antes de seguir.`,
        );
      }
    }
  }

  /**
   * Papel lido de `companyUser` escopado à empresa (um id de outra empresa não
   * aprova nada aqui) e gestor master da empresa, com a regra de
   * `podeAprovarOrdemDeCompra`.
   */
  private async exigirAprovador(
    tx: Prisma.TransactionClient,
    companyId: string,
    companyUserId: string,
    mensagem: string,
  ): Promise<void> {
    const usuario = await tx.companyUser.findFirst({
      where: { id: companyUserId, companyId },
      select: { id: true, role: true },
    });
    const config = await tx.companySettings.findUnique({
      where: { companyId },
      select: { gestorMasterCompanyUserId: true },
    });
    const pode =
      !!usuario &&
      podeAprovarOrdemDeCompra(
        { role: usuario.role, companyUserId: usuario.id },
        config?.gestorMasterCompanyUserId ?? null,
      );
    if (!pode) throw new ForbiddenException(mensagem);
  }

  /**
   * Fornecedor = parceiro FORNECEDOR, ativo, desta empresa. `pedido`: o id veio
   * no corpo e não serve (400). `estado`: a ordem aponta para um fornecedor que
   * deixou de servir desde a cotação (409).
   */
  private async exigirFornecedor(
    client: PrismaService | Prisma.TransactionClient,
    companyId: string,
    partnerId: string,
    origemDoErro: 'pedido' | 'estado',
  ): Promise<void> {
    const fornecedor = await client.partner.findFirst({
      where: { id: partnerId, companyId, type: 'FORNECEDOR', ativo: true },
      select: { id: true },
    });
    if (fornecedor) return;
    if (origemDoErro === 'pedido') {
      throw new BadRequestException('Fornecedor não encontrado: o parceiro precisa ser FORNECEDOR, ativo e desta empresa.');
    }
    throw new ConflictException('O fornecedor desta ordem não está mais ativo como FORNECEDOR — troque o fornecedor no rascunho.');
  }

  /** Mesmo molde de `AlmoxarifadoService.validarDeposito`. */
  private async validarDeposito(companyId: string, depositoId: string): Promise<void> {
    const deposito = await this.prisma.deposito.findFirst({
      where: { id: depositoId, companyId, ativo: true },
      select: { id: true },
    });
    if (!deposito) throw new NotFoundException('Depósito não encontrado.');
  }

  private async contextoDeAprovacao(companyId: string, companyUserId: string): Promise<ContextoDeAprovacao> {
    const config = await this.prisma.companySettings.findUnique({
      where: { companyId },
      select: { comprasLimiteAprovacao: true, gestorMasterCompanyUserId: true },
    });
    const usuario = await this.prisma.companyUser.findFirst({
      where: { id: companyUserId, companyId },
      select: { id: true, role: true },
    });
    return {
      limite: limiteDe(config),
      usuarioAprova:
        !!usuario &&
        podeAprovarOrdemDeCompra(
          { role: usuario.role, companyUserId: usuario.id },
          config?.gestorMasterCompanyUserId ?? null,
        ),
    };
  }

  private async lerOrdemParaAto(tx: Prisma.TransactionClient, ordemCompraId: string): Promise<OrdemParaAto> {
    return tx.ordemCompra.findUniqueOrThrow({ where: { id: ordemCompraId }, select: ORDEM_PARA_ATO });
  }

  /** Primeira coisa de todo ato sobre uma OC. */
  private async travarOrdem(tx: Prisma.TransactionClient, ordemCompraId: string, companyId: string): Promise<void> {
    const linhas = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
      SELECT id FROM ordens_compra
       WHERE id = ${ordemCompraId}::uuid
         AND company_id = ${companyId}::uuid
         FOR UPDATE
    `);
    if (!linhas[0]) throw new NotFoundException('Ordem de compra não encontrada para esta empresa.');
  }

  /**
   * Primeira coisa de rejeitar/cancelar uma SC: as linhas de item, depois o
   * cabeçalho (a ordem única). Os ids das linhas são lidos antes da trava sem
   * risco — os itens de uma SC nascem com ela e nunca mudam de cabeçalho.
   */
  private async travarSolicitacaoInteira(
    tx: Prisma.TransactionClient,
    companyId: string,
    solicitacaoId: string,
  ): Promise<void> {
    const itens = await tx.solicitacaoCompraItem.findMany({
      where: { solicitacaoId, solicitacao: { companyId } },
      select: { id: true },
    });
    await this.travarItensDeSolicitacao(
      tx,
      itens.map((i) => i.id),
    );
    await this.travarCabecalhosDeSolicitacao(tx, companyId, [solicitacaoId]);
  }

  private async travarItensDeSolicitacao(tx: Prisma.TransactionClient, itemIds: string[]): Promise<void> {
    for (const id of distintos(itemIds)) {
      const linhas = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
        SELECT id FROM solicitacao_compra_itens
         WHERE id = ${id}::uuid
           FOR UPDATE
      `);
      if (!linhas[0]) throw new NotFoundException('Item de solicitação de compra não encontrado.');
    }
  }

  private async travarCabecalhosDeSolicitacao(
    tx: Prisma.TransactionClient,
    companyId: string,
    solicitacaoIds: string[],
  ): Promise<void> {
    for (const id of distintos(solicitacaoIds)) {
      const linhas = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
        SELECT id FROM solicitacoes_compra
         WHERE id = ${id}::uuid
           AND company_id = ${companyId}::uuid
           FOR UPDATE
      `);
      if (!linhas[0]) throw new NotFoundException('Solicitação de compra não encontrada para esta empresa.');
    }
  }

  /**
   * "SC-2026-001" / "OC-2026-001": MAX+1 em NÚMERO sobre todos os do ano
   * (`proximoNumeroDocumento`), nunca por `ORDER BY` em texto.
   */
  private async proximoNumero(
    tx: Prisma.TransactionClient,
    companyId: string,
    prefixo: 'SC' | 'OC',
  ): Promise<string> {
    const ano = new Date().getUTCFullYear();
    const inicio = `${prefixo}-${ano}-`;
    const existentes =
      prefixo === 'SC'
        ? await tx.solicitacaoCompra.findMany({ where: { companyId, numero: { startsWith: inicio } }, select: { numero: true } })
        : await tx.ordemCompra.findMany({ where: { companyId, numero: { startsWith: inicio } }, select: { numero: true } });
    return proximoNumeroDocumento(
      prefixo,
      ano,
      existentes.map((e) => e.numero),
    );
  }
}
