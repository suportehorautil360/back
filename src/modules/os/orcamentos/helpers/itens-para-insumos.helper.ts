import { Prisma } from '../../../../prisma/generated/client';

/**
 * Converte os itens de PEÇA de um orçamento aprovado em insumos da OS.
 *
 * A regra por trás disto (decisão D5): orçamento é **pedido de autorização
 * para gastar**; insumo é **o que foi consumido**. Se as duas coisas somassem
 * no custo da OS, uma peça orçada e depois lançada contaria duas vezes — e
 * ninguém perceberia, porque cada número está certo no seu lugar.
 *
 * Só `category: 'part'` vira insumo. Mão de obra (`service`) já é medida pelos
 * apontamentos, e deslocamento (`travel`) não é material consumido: virar
 * insumo inflaria o custo de peças da máquina.
 *
 * Funções puras — sem Prisma Client, sem I/O. Quem grava é o chamador.
 */

/** O item como fica gravado em `Orcamento.itens` (ver `mapDtoItemsToFirestore`). */
type ItemGravado = Record<string, unknown>;

function texto(valor: unknown): string {
  if (typeof valor === 'string') return valor.trim();
  if (typeof valor === 'number' && Number.isFinite(valor)) return String(valor);
  return '';
}

function numero(valor: unknown): number | undefined {
  if (typeof valor === 'number' && Number.isFinite(valor)) return valor;
  if (typeof valor === 'string' && valor.trim()) {
    const parsed = Number(valor.replace(',', '.'));
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

export function ehItemDePeca(item: ItemGravado): boolean {
  return texto(item.category).toLowerCase() === 'part';
}

/**
 * Quantidade e valor unitário do item.
 *
 * O item gravado carrega `valor` (total da linha) e, quando a origem informou,
 * `quantidade` e `valorUnitario`. Quando não informou, a linha vale por uma
 * unidade do próprio total — assim `quantidade * valorUnit` continua batendo
 * com o que foi aprovado, que é o número que o gestor viu e autorizou.
 */
export function quantidadeEValor(item: ItemGravado): {
  quantidade: number;
  valorUnit: number;
} {
  const total = numero(item.valor ?? item.value) ?? 0;
  const quantidade = numero(item.quantidade ?? item.quantity);
  const unitario = numero(item.valorUnitario ?? item.unitValue);

  if (quantidade !== undefined && quantidade > 0 && unitario !== undefined) {
    return { quantidade, valorUnit: unitario };
  }
  if (quantidade !== undefined && quantidade > 0) {
    return { quantidade, valorUnit: total / quantidade };
  }
  return { quantidade: 1, valorUnit: total };
}

export interface InsumoDeOrcamento {
  serviceOrderId: string;
  ordem: number;
  codigo: string | null;
  descricao: string;
  marca: string | null;
  quantidade: Prisma.Decimal;
  unidade: string | null;
  valorUnit: Prisma.Decimal;
}

/**
 * Os insumos que um orçamento aprovado gera.
 *
 * `ordemInicial` continua a numeração dos insumos que a OS já tem, para o
 * lançado pelo mecânico e o vindo do orçamento não disputarem a mesma posição
 * na lista.
 */
export function itensParaInsumos(
  itens: unknown,
  serviceOrderId: string,
  ordemInicial = 0,
): InsumoDeOrcamento[] {
  if (!Array.isArray(itens)) return [];

  return itens
    .filter(
      (item): item is ItemGravado =>
        typeof item === 'object' && item !== null && ehItemDePeca(item as ItemGravado),
    )
    .map((item, i) => {
      const { quantidade, valorUnit } = quantidadeEValor(item);
      return {
        serviceOrderId,
        ordem: ordemInicial + i,
        codigo: texto(item.codigo ?? item.code) || null,
        descricao: texto(item.descricao ?? item.description),
        marca: texto(item.marca ?? item.brand) || null,
        quantidade: new Prisma.Decimal(quantidade),
        unidade: texto(item.unidade ?? item.unit) || null,
        valorUnit: new Prisma.Decimal(valorUnit.toFixed(2)),
      };
    })
    .filter((insumo) => insumo.descricao.length > 0);
}
