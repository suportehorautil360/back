import { Prisma } from '../../../prisma/generated/client';
import { situacaoDoItemDeSolicitacao, statusDaSolicitacao } from '../regras/compras';

/**
 * Recalcula o estado do CABEÇALHO de uma solicitação de compra a partir dos
 * itens e das origens deles nas ordens de compra (`statusDaSolicitacao`), e
 * grava só se mudou. `rejeitada` e `cancelada` são atos, nunca derivados — a
 * regra devolve o próprio estado atual nesses casos e nada é gravado.
 *
 * Estado derivado: a gravação é condicionada ao estado lido, sem lançar quando
 * não casa — quem mudou o cabeçalho no meio recalculou pelo mesmo critério.
 */
export async function recalcularEstadoDaSolicitacao(
  tx: Prisma.TransactionClient,
  solicitacaoId: string,
): Promise<string | null> {
  const sc = await tx.solicitacaoCompra.findUniqueOrThrow({
    where: { id: solicitacaoId },
    select: {
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
  if (novo === sc.status) return null;

  await tx.solicitacaoCompra.updateMany({
    where: { id: solicitacaoId, status: sc.status },
    data: { status: novo },
  });
  return novo;
}
