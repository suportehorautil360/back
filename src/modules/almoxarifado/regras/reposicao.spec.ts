import { justificativaDaReposicao, posicaoDeEstoque, quantidadeDeReposicao } from './reposicao';

const saldo = (fisico: number, reservado = 0) => ({ saldoFisico: fisico, saldoReservado: reservado });
const peca = (estoqueMinimo: number, loteReposicao = 0, ativo = true) => ({ ativo, estoqueMinimo, loteReposicao });

describe('posicaoDeEstoque', () => {
  it('é o disponível (físico − reservado) mais a reposição a caminho', () => {
    expect(posicaoDeEstoque(saldo(10, 4), [{ quantidade: 5, recebidoPorOrigem: [] }])).toEqual({
      disponivel: 6,
      aCaminho: 5,
      posicao: 11,
    });
  });

  it('de cada item conta só o que falta chegar — o recebido já está no físico', () => {
    const p = posicaoDeEstoque(saldo(2), [
      { quantidade: 10, recebidoPorOrigem: [2, 1.5] },
      { quantidade: 3, recebidoPorOrigem: [] },
    ]);
    expect(p).toEqual({ disponivel: 2, aCaminho: 9.5, posicao: 11.5 });
  });

  it('item recebido acima do pedido não desconta dos outros', () => {
    const p = posicaoDeEstoque(saldo(0), [
      { quantidade: 2, recebidoPorOrigem: [3] },
      { quantidade: 4, recebidoPorOrigem: [] },
    ]);
    expect(p.aCaminho).toBe(4);
  });

  it('soma em milésimos: 0,7 + 0,1 é 0,8', () => {
    expect(posicaoDeEstoque(saldo(0.7), [{ quantidade: 0.1, recebidoPorOrigem: [] }]).posicao).toBe(0.8);
  });
});

describe('quantidadeDeReposicao', () => {
  it('abaixo do mínimo com lote: pede o lote', () => {
    expect(quantidadeDeReposicao(peca(10, 25), 3)).toBe(25);
  });

  it('abaixo do mínimo sem lote: pede o que falta para voltar ao mínimo', () => {
    expect(quantidadeDeReposicao(peca(10), 3.5)).toBe(6.5);
  });

  it('igual ao mínimo não pede', () => {
    expect(quantidadeDeReposicao(peca(10, 25), 10)).toBe(0);
  });

  it('acima do mínimo não pede', () => {
    expect(quantidadeDeReposicao(peca(10), 11)).toBe(0);
  });

  it('mínimo zero é "não controlo esta peça por mínimo" — nem saldo inconsistente (posição negativa) pede', () => {
    expect(quantidadeDeReposicao(peca(0, 5), 0)).toBe(0);
    expect(quantidadeDeReposicao(peca(0, 5), -2)).toBe(0);
  });

  it('peça inativa não pede', () => {
    expect(quantidadeDeReposicao(peca(10, 0, false), 0)).toBe(0);
  });

  it('compara em milésimos: um resíduo de ponto flutuante não fica abaixo do mínimo', () => {
    expect(quantidadeDeReposicao(peca(0.8), 0.7 + 0.1)).toBe(0);
  });
});

describe('justificativaDaReposicao', () => {
  it('diz a conta com vírgula decimal', () => {
    expect(justificativaDaReposicao({ disponivel: 1.5, aCaminho: 2, posicao: 3.5 }, 10)).toBe(
      'Reposição automática: disponível 1,5 + a caminho 2 abaixo do mínimo 10.',
    );
  });
});
