/**
 * A conta da reposição automática por estoque mínimo. Módulo puro: sem Prisma,
 * sem Nest.
 *
 * Em milésimos inteiros, como `regras/compras.ts` (a coluna é `NUMERIC(12,3)`),
 * e só volta a `number` na saída. Em ponto flutuante `0.7 + 0.1` dá
 * `0.7999999999999999`: uma posição de 0,8 "abaixo" de um mínimo de 0,8
 * abriria uma solicitação que ninguém precisa.
 *
 * Por que não `abaixoDoMinimo`/`quantidadeAComprar` de `disponibilidade.ts`:
 * elas olham só o disponível. Cada reserva baixa o disponível, e a reposição
 * pedida continua não estando na prateleira até chegar — por aquela conta,
 * toda reserva feita enquanto a primeira compra não chega pediria de novo.
 */

function milesimos(n: number): number {
  return Math.round(n * 1000);
}

function deMilesimos(n: number): number {
  return n / 1000;
}

/** Um item de solicitação de reposição ainda aberto, como a posição o vê. */
export interface ReposicaoPendente {
  quantidade: number;
  /** `quantidadeRecebida` de cada origem de OC do item — já está no físico. */
  recebidoPorOrigem: number[];
}

export interface PosicaoDeEstoque {
  /** Físico − reservado. */
  disponivel: number;
  /** Reposição pedida e ainda não recebida. */
  aCaminho: number;
  /** Disponível + a caminho: o que é comparado com o mínimo. */
  posicao: number;
}

/**
 * A posição de uma peça num depósito: o disponível mais a reposição já pedida
 * e ainda não recebida. De cada item conta só o que falta chegar — o recebido
 * já entrou no físico, e contá-lo de novo esconderia a falta. Item recebido
 * acima do pedido não desconta dos outros.
 */
export function posicaoDeEstoque(
  saldo: { saldoFisico: number; saldoReservado: number },
  pendentes: ReposicaoPendente[],
): PosicaoDeEstoque {
  const disponivel = milesimos(saldo.saldoFisico) - milesimos(saldo.saldoReservado);
  let aCaminho = 0;
  for (const p of pendentes) {
    const recebido = p.recebidoPorOrigem.reduce((soma, r) => soma + milesimos(r), 0);
    aCaminho += Math.max(0, milesimos(p.quantidade) - recebido);
  }
  return {
    disponivel: deMilesimos(disponivel),
    aCaminho: deMilesimos(aCaminho),
    posicao: deMilesimos(disponivel + aCaminho),
  };
}

/**
 * Quanto a reposição automática pede: zero quando não há o que pedir (peça
 * inativa, mínimo zero ou posição igual/acima do mínimo). Abaixo do mínimo,
 * o lote de reposição quando a peça tem um; sem lote, o que falta para a
 * posição voltar ao mínimo.
 */
export function quantidadeDeReposicao(
  peca: { ativo: boolean; estoqueMinimo: number; loteReposicao: number },
  posicao: number,
): number {
  if (!peca.ativo) return 0;
  const minimo = milesimos(peca.estoqueMinimo);
  if (minimo <= 0) return 0;
  const atual = milesimos(posicao);
  if (atual >= minimo) return 0;
  const lote = milesimos(peca.loteReposicao);
  return deMilesimos(lote > 0 ? lote : minimo - atual);
}

/** Vírgula decimal sem depender do ICU do runtime. */
function numero(n: number): string {
  return String(n).replace('.', ',');
}

/** O texto que Compras lê na solicitação automática. */
export function justificativaDaReposicao(posicao: PosicaoDeEstoque, minimo: number): string {
  return (
    `Reposição automática: disponível ${numero(posicao.disponivel)} + a caminho ` +
    `${numero(posicao.aCaminho)} abaixo do mínimo ${numero(minimo)}.`
  );
}
