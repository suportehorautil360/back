import { disponivel } from './disponibilidade';

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
