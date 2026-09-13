import { Prisma } from '../../../prisma/generated/client';
import { proximoNumeroDocumento } from '../helpers/numero-documento.helper';
import { situacaoDoItemDeSolicitacao, statusDaSolicitacao } from '../regras/compras';

/** Uma falta de um item de requisição, pronta para virar item de solicitação. */
export interface FaltaParaSolicitar {
  requisicaoItemId: string;
  pecaId: string;
  quantidade: number;
  impeditivo: boolean;
}

export interface SolicitacaoAberta {
  id: string;
  numero: string;
  prioridade: 'critica' | 'alta';
  itens: number;
}

/**
 * Abre a solicitação de compra das faltas de uma requisição, na MESMA
 * transação que criou os itens faltantes. É o critério 2 do §13 ("estoque
 * parcial → reserva o disponível e solicita só a diferença"): a falta e a
 * solicitação nascem juntas, e uma OS nunca fica `aguardando_compra` sem uma
 * solicitação que alguém de Compras veja.
 *
 * Uma SC por chamada, um item por falta, cada item apontando para o item de
 * requisição que ele cobre. O índice único parcial
 * `solicitacao_compra_itens_uma_por_falta` impede uma segunda solicitação viva
 * para a mesma falta (critério 3) — mesmo que duas transações tentem.
 *
 * Prioridade: `critica` para falta de item impeditivo (a máquina não começa
 * sem ela), `alta` para o resto da OS. O cabeçalho leva a mais alta dos itens.
 *
 * O número (`SC-2026-001`) é MAX+1 por empresa: o índice único de
 * `(company_id, numero)` DETECTA a colisão, e quem absorve é o retry de
 * contenção de quem chamou (`erroDeContencaoTransitoria` reconhece o `P2002`
 * de número).
 */
export async function abrirSolicitacaoDasFaltas(
  tx: Prisma.TransactionClient,
  input: {
    companyId: string;
    depositoId: string;
    serviceOrderId: string;
    requisicaoId: string;
    /** Quem abriu a OS (ou pediu a peça). Nulo quando foi o sistema. */
    solicitanteCompanyUserId: string | null;
    origem: 'falta_os' | 'peca_adicional';
    dataNecessidade: Date | null;
    faltas: FaltaParaSolicitar[];
  },
): Promise<SolicitacaoAberta | null> {
  const faltas = input.faltas.filter((f) => Math.round(f.quantidade * 1000) > 0);
  if (faltas.length === 0) return null;

  const ano = new Date().getUTCFullYear();
  const existentes = await tx.solicitacaoCompra.findMany({
    where: { companyId: input.companyId, numero: { startsWith: `SC-${ano}-` } },
    select: { numero: true },
  });
  const numero = proximoNumeroDocumento('SC', ano, existentes.map((e) => e.numero));
  const prioridade = faltas.some((f) => f.impeditivo) ? 'critica' : 'alta';

  const sc = await tx.solicitacaoCompra.create({
    data: {
      companyId: input.companyId,
      numero,
      origem: input.origem,
      prioridade,
      depositoId: input.depositoId,
      serviceOrderId: input.serviceOrderId,
      requisicaoId: input.requisicaoId,
      solicitanteCompanyUserId: input.solicitanteCompanyUserId,
      itens: {
        create: faltas.map((f) => ({
          pecaId: f.pecaId,
          quantidade: f.quantidade,
          requisicaoItemId: f.requisicaoItemId,
          prioridade: f.impeditivo ? 'critica' : 'alta',
          dataNecessidade: input.dataNecessidade,
        })),
      },
    },
    select: { id: true, numero: true },
  });

  return { id: sc.id, numero: sc.numero, prioridade, itens: faltas.length };
}

export interface SolicitacaoCanceladaPelaRequisicao {
  solicitacaoId: string;
  numero: string;
  /** Números das OCs (não canceladas) onde havia unidade desta solicitação. */
  ordensDeCompra: string[];
}

/**
 * Cancela os itens de solicitação de compra VIVOS que cobriam faltas de itens
 * de requisição que deixaram de existir — a requisição foi cancelada.
 *
 * Trava as linhas de item de solicitação em ordem de id (`ORDER BY id FOR
 * UPDATE`), relê depois da trava e só então escreve. Em seguida recalcula o
 * cabeçalho de cada solicitação tocada: se todos os itens dela ficaram
 * cancelados, a solicitação é cancelada com o motivo; senão o estado dela é
 * recalculado pelos itens que sobraram.
 *
 * Não mexe em ordem de compra. O que está numa OC em rascunho é barrado na
 * confirmação dela (item de solicitação cancelado), e o que já foi comprado
 * segue a caminho e vira estoque livre quando chegar — a distribuição do
 * recebimento não acha mais a falta. Quem chama avisa Compras com a lista
 * devolvida.
 *
 * Chamado com a requisição já travada, antes das travas de `peca_saldos`
 * (ordem única de trava: requisição → linhas de solicitação → saldo).
 */
export async function cancelarSolicitacoesDasFaltas(
  tx: Prisma.TransactionClient,
  input: {
    companyId: string;
    requisicaoItemIds: string[];
    autorCompanyUserId: string;
    motivo: string;
  },
): Promise<SolicitacaoCanceladaPelaRequisicao[]> {
  if (input.requisicaoItemIds.length === 0) return [];

  const candidatos = await tx.solicitacaoCompraItem.findMany({
    where: {
      requisicaoItemId: { in: input.requisicaoItemIds },
      status: 'aberta',
      solicitacao: { companyId: input.companyId },
    },
    select: { id: true },
  });
  if (candidatos.length === 0) return [];

  const ids = candidatos.map((c) => c.id).sort();
  await tx.$queryRaw(Prisma.sql`
    SELECT id FROM solicitacao_compra_itens
     WHERE id = ANY(${ids}::uuid[])
     ORDER BY id
       FOR UPDATE
  `);

  const frescos = await tx.solicitacaoCompraItem.findMany({
    where: { id: { in: ids }, status: 'aberta' },
    select: {
      id: true,
      solicitacaoId: true,
      origensOc: {
        select: { ordemCompraItem: { select: { ordemCompra: { select: { numero: true, status: true } } } } },
      },
    },
  });
  if (frescos.length === 0) return [];

  await tx.solicitacaoCompraItem.updateMany({
    where: { id: { in: frescos.map((f) => f.id) }, status: 'aberta' },
    data: { status: 'cancelada' },
  });

  const ordensPorSolicitacao = new Map<string, Set<string>>();
  for (const f of frescos) {
    const ordens = ordensPorSolicitacao.get(f.solicitacaoId) ?? new Set<string>();
    for (const o of f.origensOc) {
      if (o.ordemCompraItem.ordemCompra.status !== 'cancelada') ordens.add(o.ordemCompraItem.ordemCompra.numero);
    }
    ordensPorSolicitacao.set(f.solicitacaoId, ordens);
  }

  const resultado: SolicitacaoCanceladaPelaRequisicao[] = [];
  for (const solicitacaoId of [...ordensPorSolicitacao.keys()].sort()) {
    const sc = await tx.solicitacaoCompra.findUniqueOrThrow({
      where: { id: solicitacaoId },
      select: {
        numero: true,
        status: true,
        itens: {
          select: {
            status: true,
            quantidade: true,
            origensOc: {
              select: {
                quantidade: true,
                quantidadeRecebida: true,
                ordemCompraItem: { select: { ordemCompra: { select: { status: true } } } },
              },
            },
          },
        },
      },
    });

    if (sc.itens.every((i) => i.status === 'cancelada')) {
      await tx.solicitacaoCompra.updateMany({
        where: { id: solicitacaoId, status: { notIn: ['rejeitada', 'cancelada'] } },
        data: {
          status: 'cancelada',
          canceladaEm: new Date(),
          canceladaPorCompanyUserId: input.autorCompanyUserId,
          motivoCancelamento: input.motivo,
        },
      });
    } else {
      const novo = statusDaSolicitacao(
        sc.status,
        sc.itens.map((i) => {
          const s = situacaoDoItemDeSolicitacao(
            Number(i.quantidade),
            i.origensOc.map((o) => ({
              statusOrdemCompra: o.ordemCompraItem.ordemCompra.status,
              quantidade: Number(o.quantidade),
              quantidadeRecebida: Number(o.quantidadeRecebida),
            })),
          );
          return { status: i.status, quantidade: Number(i.quantidade), comprado: s.comprado, emCotacao: s.emCotacao };
        }),
      );
      if (novo !== sc.status) {
        await tx.solicitacaoCompra.updateMany({
          where: { id: solicitacaoId, status: sc.status },
          data: { status: novo },
        });
      }
    }

    resultado.push({
      solicitacaoId,
      numero: sc.numero,
      ordensDeCompra: [...(ordensPorSolicitacao.get(solicitacaoId) ?? [])].sort(),
    });
  }
  return resultado;
}
