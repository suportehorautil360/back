/** Os tipos do razão. `transferencia` só é usada na fase 2. */
export type TipoMovimento =
  | 'entrada'
  | 'saida'
  | 'ajuste'
  | 'devolucao'
  | 'transferencia';

/**
 * O sinal DO TIPO. `ajuste` e `transferencia` devolvem 1 porque a direção
 * deles vem na quantidade — o tipo diz o motivo, não o sentido.
 */
export function sinalDoTipo(t: TipoMovimento): 1 | -1 {
  return t === 'saida' ? -1 : 1;
}

/**
 * Média ponderada. É ela que vai para o custo da OS na entrega.
 *
 * `custoEntrada` nulo mantém a média: devolução de sobra volta sem nota, e
 * tratá-la como entrada a custo zero achataria o valor do estoque.
 */
export function novoCustoMedio(
  custoAtual: number,
  saldoAtual: number,
  qtdEntrada: number,
  custoEntrada: number | null,
): number {
  if (custoEntrada === null) return custoAtual;
  const saldo = Math.max(0, saldoAtual);
  const total = saldo + qtdEntrada;
  if (total <= 0) return custoEntrada;
  return (saldo * custoAtual + qtdEntrada * custoEntrada) / total;
}
