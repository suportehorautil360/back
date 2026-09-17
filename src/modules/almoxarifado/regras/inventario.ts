/**
 * A aritmética do inventário cíclico (§5.2 do desenho de 16/09).
 *
 * Módulo puro: sem Prisma, sem Nest. Aqui mora só a decisão de quanto ajustar
 * e se o ajuste cabe.
 */

/** Milésimos: a coluna é `NUMERIC(12,3)` e float puro vira centavo fantasma. */
function milesimos(n: number): number {
  return Math.round(n * 1000);
}

export interface ItemContado {
  quantidadeContada: number | null;
  saldoNaContagem: number | null;
}

/**
 * A diferença é um fato sobre o INSTANTE da contagem. Aplicá-la como delta ao
 * saldo de agora é correto independentemente do que se moveu no meio — é isso
 * que permite a contagem correr junto com a operação.
 *
 * `null` é "não contado". ZERO é resultado: o item foi contado e bateu.
 */
export function ajusteDoItem(item: ItemContado): number | null {
  if (item.quantidadeContada === null || item.saldoNaContagem === null) return null;
  return (milesimos(item.quantidadeContada) - milesimos(item.saldoNaContagem)) / 1000;
}

/** Apurar sem nenhum item contado fecharia a contagem sem contar nada. */
export function podeApurar(itens: ItemContado[]): boolean {
  return itens.some((i) => ajusteDoItem(i) !== null);
}

export interface SaldoParaAjustar {
  saldoFisico: number;
  saldoReservado: number;
}

/**
 * O CHECK `saldo_reservado <= saldo_fisico` já existe no banco. Esta função
 * existe para a recusa sair compreensível em vez de erro de constraint: a
 * contagem achou menos do que já está comprometido com uma OS, e isso se trata
 * na reserva antes de se tratar no saldo.
 */
export function ajusteCabeNoSaldo(saldo: SaldoParaAjustar, ajuste: number): boolean {
  const depois = milesimos(saldo.saldoFisico) + milesimos(ajuste);
  return depois >= 0 && depois >= milesimos(saldo.saldoReservado);
}
