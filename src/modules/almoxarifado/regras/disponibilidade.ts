/**
 * As contas de saldo. Módulo puro: sem Prisma, sem Nest.
 *
 * `disponivel` é DERIVADO em toda parte e nunca gravado — duas fontes para o
 * mesmo número divergem no primeiro bug, e este é o número que decide se uma
 * máquina para.
 */

export interface Saldo {
  saldoFisico: number;
  saldoReservado: number;
  saldoSeparado: number;
  saldoEmCompra: number;
}

export function disponivel(s: Saldo): number {
  return s.saldoFisico - s.saldoReservado;
}

/** Mínimo zero significa "não controlo esta peça por mínimo". */
export function abaixoDoMinimo(s: Saldo, minimo: number): boolean {
  if (minimo <= 0) return false;
  return disponivel(s) < minimo;
}

export function quantidadeAComprar(
  s: Saldo,
  minimo: number,
  lote: number,
): number {
  if (lote > 0) return lote;
  return Math.max(0, minimo - disponivel(s));
}
