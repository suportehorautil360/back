/**
 * As contas de saldo. Módulo puro: sem Prisma, sem Nest.
 *
 * O mínimo NÃO mora aqui: quem decide reposição é `regras/reposicao.ts`, que
 * compara o mínimo com a POSIÇÃO (disponível mais o que já está a caminho numa
 * ordem de compra). As duas funções que ficavam neste arquivo comparavam só o
 * disponível e abririam uma solicitação nova a cada reserva enquanto a
 * primeira não chegasse — saíram na F4.2, sem nunca terem tido chamador.
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
