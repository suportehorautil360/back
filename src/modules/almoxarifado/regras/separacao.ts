/**
 * A conferência do kit. Módulo puro: sem Prisma, sem Nest.
 *
 * Separar não é reservar de novo — a peça já está comprometida. O que este
 * módulo decide é o que o almoxarife pode AFIRMAR sobre o que ele tem na mão,
 * e quando o kit passa a estar pronto.
 */

export interface ItemParaSeparar {
  quantidadeReservada: number;
  /** "faltante" | "reservada" | "separada" | "entregue" | "cancelada" | "nao_vinculado" */
  status: string;
  impeditivo: boolean;
  divergencia: string | null;
}

export interface ConferenciaDoItem {
  quantidade: number;
  divergencia?: string | null;
}

export type ResultadoDaConferencia =
  | { ok: true; quantidade: number }
  | { ok: false; erro: string };

/** Só item já reservado tem o que conferir. */
const CONFERIVEL = new Set(['reservada', 'separada']);
const FORA = new Set(['cancelada']);

export function validarConferencia(
  item: ItemParaSeparar,
  conferido: ConferenciaDoItem,
): ResultadoDaConferencia {
  if (!CONFERIVEL.has(item.status)) {
    return { ok: false, erro: 'Item ainda não reservado não pode ser separado.' };
  }
  if (conferido.quantidade < 0) {
    return { ok: false, erro: 'Quantidade separada não pode ser negativa.' };
  }
  if (conferido.quantidade > item.quantidadeReservada) {
    return {
      ok: false,
      erro: `Não dá para separar ${conferido.quantidade} de um item com ${item.quantidadeReservada} reservado.`,
    };
  }
  return { ok: true, quantidade: conferido.quantidade };
}

/**
 * "Separada" quer dizer "está no kit, inteira". Conferir em parte deixa o item
 * em `reservada` de propósito: meio item não libera meia OS.
 */
export function statusDoItemAposSeparacao(
  item: ItemParaSeparar,
  conferido: ConferenciaDoItem,
): string {
  return conferido.quantidade >= item.quantidadeReservada && conferido.quantidade > 0
    ? 'separada'
    : 'reservada';
}

/**
 * O kit está pronto quando todos os IMPEDITIVOS vivos estão separados.
 *
 * Lista vazia devolve `false`: kit vazio não é kit pronto.
 */
export function requisicaoEstaSeparada(itens: ItemParaSeparar[]): boolean {
  const vivos = itens.filter((i) => !FORA.has(i.status));
  if (vivos.length === 0) return false;
  const impeditivos = vivos.filter((i) => i.impeditivo);
  if (impeditivos.length === 0) return vivos.every((i) => i.status === 'separada');
  return impeditivos.every((i) => i.status === 'separada');
}

export function temDivergencia(itens: ItemParaSeparar[]): boolean {
  return itens.some(
    (i) => !FORA.has(i.status) && (i.divergencia ?? '').trim().length > 0,
  );
}
