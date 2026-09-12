import { abaixoDoMinimo, disponivel, quantidadeAComprar } from './disponibilidade';

const saldo = (fisico: number, reservado = 0, emCompra = 0) => ({
  saldoFisico: fisico,
  saldoReservado: reservado,
  saldoSeparado: 0,
  saldoEmCompra: emCompra,
});

describe('disponivel', () => {
  it('desconta o que já está comprometido com outra OS', () => {
    // Pág. 3 do spec funcional: "saldo reservado para outra OS não é tratado
    // como disponível". É o teste que separa este módulo de um contador.
    expect(disponivel(saldo(5, 4))).toBe(1);
  });

  it('não conta o que está em compra', () => {
    // Em compra é promessa de fornecedor, não peça na prateleira.
    expect(disponivel(saldo(0, 0, 10))).toBe(0);
  });
});

describe('abaixoDoMinimo', () => {
  it('compara o DISPONÍVEL com o mínimo, não o físico', () => {
    // Físico 10 com 9 reservados é 1 disponível: está abaixo de um mínimo 4,
    // ainda que a prateleira pareça cheia.
    expect(abaixoDoMinimo(saldo(10, 9), 4)).toBe(true);
  });

  it('igual ao mínimo não dispara', () => {
    expect(abaixoDoMinimo(saldo(4), 4)).toBe(false);
  });

  it('mínimo zero nunca dispara', () => {
    expect(abaixoDoMinimo(saldo(0), 0)).toBe(false);
  });
});

describe('quantidadeAComprar', () => {
  it('sem lote definido, compra o que falta para voltar ao mínimo', () => {
    expect(quantidadeAComprar(saldo(1), 4, 0)).toBe(3);
  });

  it('com lote definido, compra o lote', () => {
    expect(quantidadeAComprar(saldo(1), 4, 10)).toBe(10);
  });

  it('nunca devolve negativo', () => {
    expect(quantidadeAComprar(saldo(9), 4, 0)).toBe(0);
  });
});
