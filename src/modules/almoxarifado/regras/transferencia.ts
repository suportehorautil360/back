/**
 * As decisões da transferência entre depósitos (§5.3 do desenho de 16/09).
 * Módulo puro: sem Prisma, sem Nest.
 */

/** Milésimos: a coluna é `NUMERIC(12,3)` e float puro vira centavo fantasma. */
function milesimos(n: number): number {
  return Math.round(n * 1000);
}

export interface SaldoDaOrigem {
  saldoFisico: number;
  saldoReservado: number;
}

/**
 * Só o DISPONÍVEL viaja. Quantidade reservada está comprometida com uma máquina
 * parada, e mandá-la para outra obra é perder o serviço — é o mesmo raciocínio
 * do §7 do desenho original sobre não expirar reserva sozinho.
 */
export function cabeNoDisponivel(saldo: SaldoDaOrigem, quantidade: number): boolean {
  // Falha fechada, e agora dito em voz alta em vez de depender de `NaN`
  // devolver false em toda comparação: valor que não é número não viaja.
  if (
    !Number.isFinite(saldo.saldoFisico) ||
    !Number.isFinite(saldo.saldoReservado) ||
    !Number.isFinite(quantidade)
  ) {
    return false;
  }
  const livre = milesimos(saldo.saldoFisico) - milesimos(saldo.saldoReservado);
  return milesimos(quantidade) <= livre;
}

export interface ItemRecebido {
  quantidade: number;
  quantidadeRecebida: number;
}

/** Chegou menos do que saiu — inclusive quando chegou zero. */
export function temDivergencia(item: ItemRecebido): boolean {
  // Número que não é finito NÃO é "chegou tudo". `NaN` faz toda comparação em
  // JS devolver false, e sem esta guarda a função devolveria "sem divergência"
  // para um dado corrompido — exatamente o que ela existe para sinalizar.
  // Divergência obriga motivo, e o CHECK do banco recusa motivo vazio: o valor
  // sujo trava o recebimento em vez de virar carga perfeita.
  if (!Number.isFinite(item.quantidade) || !Number.isFinite(item.quantidadeRecebida)) {
    return true;
  }
  return milesimos(item.quantidadeRecebida) < milesimos(item.quantidade);
}

/**
 * Confirmar sempre FECHA a transferência, com ou sem divergência: o que não
 * chegou não vem depois, e um documento que ficasse aberto esperando o resto
 * seria uma pendência que ninguém pode resolver.
 */
export function statusAposRecebimento(_itens: ItemRecebido[]): 'recebida' {
  return 'recebida';
}
