import { ajusteCabeNoSaldo, ajusteDoItem, podeApurar } from './inventario';

describe('ajusteDoItem', () => {
  it('a diferença é contada menos o saldo do INSTANTE da contagem', () => {
    expect(ajusteDoItem({ quantidadeContada: 8, saldoNaContagem: 10 })).toBe(-2);
    expect(ajusteDoItem({ quantidadeContada: 12, saldoNaContagem: 10 })).toBe(2);
  });

  it('contar exatamente o que o sistema diz dá ajuste zero, não null', () => {
    // Zero é resultado: o item foi contado e bateu. `null` é "não contado".
    expect(ajusteDoItem({ quantidadeContada: 10, saldoNaContagem: 10 })).toBe(0);
  });

  it('contagem de ZERO é um número — a prateleira estava vazia', () => {
    expect(ajusteDoItem({ quantidadeContada: 0, saldoNaContagem: 4 })).toBe(-4);
  });

  it('item não contado não tem ajuste', () => {
    expect(ajusteDoItem({ quantidadeContada: null, saldoNaContagem: null })).toBeNull();
  });

  it('arredonda em milésimos — a coluna é NUMERIC(12,3)', () => {
    expect(ajusteDoItem({ quantidadeContada: 0.1 + 0.2, saldoNaContagem: 0 })).toBe(0.3);
  });
});

describe('podeApurar', () => {
  it('contagem sem nenhum item contado não apura', () => {
    expect(podeApurar([{ quantidadeContada: null, saldoNaContagem: null }])).toBe(false);
  });

  it('basta um item contado para haver o que apurar', () => {
    expect(
      podeApurar([
        { quantidadeContada: null, saldoNaContagem: null },
        { quantidadeContada: 3, saldoNaContagem: 3 },
      ]),
    ).toBe(true);
  });

  it('contagem vazia não apura', () => {
    expect(podeApurar([])).toBe(false);
  });
});

describe('ajusteCabeNoSaldo', () => {
  it('ajuste positivo sempre cabe', () => {
    expect(ajusteCabeNoSaldo({ saldoFisico: 5, saldoReservado: 5 }, 3)).toBe(true);
  });

  it('ajuste negativo que deixa o físico acima do reservado cabe', () => {
    expect(ajusteCabeNoSaldo({ saldoFisico: 10, saldoReservado: 4 }, -6)).toBe(true);
  });

  it('ajuste que derruba o físico ABAIXO do reservado não cabe', () => {
    // O CHECK `saldo_reservado <= saldo_fisico` já existe no banco. Esta
    // função existe para a recusa ser compreensível em vez de erro de
    // constraint: a contagem achou menos do que já está comprometido com uma
    // OS, e isso se trata na reserva antes de se tratar no saldo.
    expect(ajusteCabeNoSaldo({ saldoFisico: 10, saldoReservado: 8 }, -5)).toBe(false);
  });

  it('ajuste que deixa o físico EXATAMENTE no reservado cabe', () => {
    expect(ajusteCabeNoSaldo({ saldoFisico: 10, saldoReservado: 4 }, -6)).toBe(true);
  });

  it('ajuste que deixaria o físico negativo não cabe', () => {
    expect(ajusteCabeNoSaldo({ saldoFisico: 3, saldoReservado: 0 }, -5)).toBe(false);
  });
});
