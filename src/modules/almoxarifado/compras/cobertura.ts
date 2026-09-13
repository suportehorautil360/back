import { NotFoundException } from '@nestjs/common';
import { Prisma } from '../../../prisma/generated/client';
import {
  cobertura,
  faltaDoItem,
  statusMateriaisComCompra,
  type FaltaComCobertura,
  type OrigemParaCobertura,
} from '../regras/compras';
import type { StatusMateriais } from '../regras/status-materiais';

/** O que basta saber de um item de requisição para calcular a falta dele. */
export interface ItemParaCobertura {
  id: string;
  status: string;
  quantidadeSolicitada: Prisma.Decimal | number | string;
  quantidadeReservada: Prisma.Decimal | number | string;
}

/**
 * A falta de cada item `faltante` e o quanto a compra já cobre dela, lidos com
 * o client da transação.
 *
 * Quem chama TEM de estar com a requisição desses itens travada
 * (`travarRequisicao`): todo ato que muda a cobertura de uma falta — emitir,
 * cancelar ou encerrar uma ordem de compra, receber — trava as requisições
 * afetadas antes de escrever, então com a trava na mão o que se lê aqui é o
 * estado que vale. Cotação (OC em rascunho ou aguardando aprovação) não muda a
 * cobertura e por isso não trava requisição nenhuma.
 *
 * Só itens de solicitação VIVOS entram: um item de SC cancelado não cobre
 * falta nenhuma, mesmo que tenha origem numa OC.
 */
export async function faltasComCobertura(
  tx: Prisma.TransactionClient,
  itens: ItemParaCobertura[],
): Promise<FaltaComCobertura[]> {
  const faltantes = itens.filter((i) => i.status === 'faltante');
  if (faltantes.length === 0) return [];

  const itensDeSolicitacao = await tx.solicitacaoCompraItem.findMany({
    where: {
      requisicaoItemId: { in: faltantes.map((i) => i.id) },
      status: { not: 'cancelada' },
    },
    select: {
      requisicaoItemId: true,
      origensOc: {
        select: {
          quantidade: true,
          quantidadeRecebida: true,
          ordemCompraItem: { select: { ordemCompra: { select: { status: true } } } },
        },
      },
    },
  });

  const origensPorItem = new Map<string, OrigemParaCobertura[]>();
  for (const sc of itensDeSolicitacao) {
    if (!sc.requisicaoItemId) continue;
    const lista = origensPorItem.get(sc.requisicaoItemId) ?? [];
    for (const o of sc.origensOc) {
      lista.push({
        statusOrdemCompra: o.ordemCompraItem.ordemCompra.status,
        quantidade: Number(o.quantidade),
        quantidadeRecebida: Number(o.quantidadeRecebida),
      });
    }
    origensPorItem.set(sc.requisicaoItemId, lista);
  }

  return faltantes.map((i) => ({
    falta: faltaDoItem({
      status: i.status,
      quantidadeSolicitada: Number(i.quantidadeSolicitada),
      quantidadeReservada: Number(i.quantidadeReservada),
    }),
    cobertura: cobertura(origensPorItem.get(i.id) ?? []),
  }));
}

/**
 * Refina o `statusMateriais` que a máquina da F3 decidiu pelo andamento da
 * compra (`statusMateriaisComCompra`). Só consulta o banco quando a máquina
 * disse `aguardando_compra` — em qualquer outro estado não há falta a olhar.
 * Mesmo requisito de trava de `faltasComCobertura`.
 */
export async function refinarPelaCompra(
  tx: Prisma.TransactionClient,
  base: StatusMateriais,
  itens: ItemParaCobertura[],
): Promise<StatusMateriais> {
  if (base !== 'aguardando_compra') return base;
  return statusMateriaisComCompra(base, await faltasComCobertura(tx, itens));
}

/** Os três estados em que o andamento da compra decide o `statusMateriais`. */
const ESTADOS_DE_COMPRA = new Set<string>(['aguardando_compra', 'compra_em_andamento', 'recebimento_parcial']);

/**
 * Recalcula o `statusMateriais` da OS de uma requisição depois de um ato de
 * COMPRA que muda a cobertura das faltas dela sem mexer nos itens: emitir (ou
 * aprovar e emitir), cancelar ou encerrar uma ordem de compra.
 *
 * Só mexe numa OS que está num dos três estados de compra. Os itens não
 * mudaram, então a máquina da F3 continua dizendo `aguardando_compra` e só o
 * refinamento pela cobertura pode mudar o resultado. Uma OS fora desses
 * estados não tem falta cujo andamento de compra mude o estado dela: com item
 * não vinculado ela está em análise (e continua), e sem item faltante ela nem
 * espera compra.
 *
 * O recebimento NÃO usa esta função: ele muda os itens (reserva o que chegou),
 * e o estado depois dele sai da máquina inteira.
 *
 * Requisito: a requisição travada (`travarRequisicao`) — é a trava que torna
 * confiável a leitura dos itens e da cobertura. Devolve o estado gravado, ou
 * `null` quando não havia o que mudar.
 */
export async function recalcularStatusDeCompraDaOs(
  tx: Prisma.TransactionClient,
  input: { requisicaoId: string; companyId: string },
): Promise<StatusMateriais | null> {
  const req = await tx.requisicaoMaterial.findFirst({
    where: { id: input.requisicaoId, companyId: input.companyId },
    select: {
      serviceOrderId: true,
      serviceOrder: { select: { statusMateriais: true } },
      itens: { select: { id: true, status: true, quantidadeSolicitada: true, quantidadeReservada: true } },
    },
  });
  if (!req) return null;

  const atual = req.serviceOrder.statusMateriais;
  if (!ESTADOS_DE_COMPRA.has(atual)) return null;

  const novo = statusMateriaisComCompra('aguardando_compra', await faltasComCobertura(tx, req.itens));
  if (novo === atual) return null;

  const gravado = await tx.serviceOrder.updateMany({
    where: { id: req.serviceOrderId, companyId: input.companyId },
    data: { statusMateriais: novo },
  });
  if (gravado.count === 0) throw new NotFoundException('OS não encontrada para esta empresa.');
  return novo;
}
