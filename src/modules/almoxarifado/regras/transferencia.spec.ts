import { cabeNoDisponivel, statusAposRecebimento, temDivergencia } from './transferencia';

describe('cabeNoDisponivel', () => {
  it('o que está livre pode viajar', () => {
    expect(cabeNoDisponivel({ saldoFisico: 10, saldoReservado: 4 }, 5)).toBe(true);
  });

  it('o que está RESERVADO não viaja', () => {
    // Reserva é peça comprometida com uma máquina parada. Mandá-la para outra
    // obra é perder o serviço — mesmo raciocínio do §7 sobre não expirar
    // reserva sozinho.
    expect(cabeNoDisponivel({ saldoFisico: 10, saldoReservado: 4 }, 7)).toBe(false);
  });

  it('levar exatamente o disponível cabe', () => {
    expect(cabeNoDisponivel({ saldoFisico: 10, saldoReservado: 4 }, 6)).toBe(true);
  });

  it('peça inteiramente reservada não transfere nada', () => {
    expect(cabeNoDisponivel({ saldoFisico: 5, saldoReservado: 5 }, 1)).toBe(false);
  });

  it('compara em milésimos — a coluna é NUMERIC(12,3)', () => {
    expect(cabeNoDisponivel({ saldoFisico: 0.3, saldoReservado: 0 }, 0.1 + 0.2)).toBe(true);
  });

  it('quantidade que não é número não viaja', () => {
    // Estes dois passariam mesmo sem a guarda — `NaN <= 10000` e
    // `Infinity <= 10000` já são false sozinhos. Ficam como documentação da
    // intenção; quem exercita a guarda é o teste abaixo.
    expect(cabeNoDisponivel({ saldoFisico: 10, saldoReservado: 0 }, NaN)).toBe(false);
    expect(cabeNoDisponivel({ saldoFisico: 10, saldoReservado: 0 }, Infinity)).toBe(false);
  });

  it('saldo corrompido não abençoa qualquer quantidade', () => {
    // Este é o caso perigoso, e o único que observa a guarda: sem ela,
    // `saldoFisico: Infinity` faz o disponível virar Infinity e TODA quantidade
    // cabe — 10, mil, o que for. Um saldo sujo liberaria a peça inteira.
    expect(cabeNoDisponivel({ saldoFisico: Infinity, saldoReservado: 0 }, 10)).toBe(false);
    expect(cabeNoDisponivel({ saldoFisico: NaN, saldoReservado: 0 }, 10)).toBe(false);
  });
});

describe('temDivergencia', () => {
  it('chegou tudo não é divergência', () => {
    expect(temDivergencia({ quantidade: 10, quantidadeRecebida: 10 })).toBe(false);
  });

  it('chegou menos é divergência', () => {
    expect(temDivergencia({ quantidade: 10, quantidadeRecebida: 7 })).toBe(true);
  });

  it('não chegou nada é divergência, não é "sem recebimento"', () => {
    // A carga se perdeu. O razão vai mostrar saída de 10 e entrada de 0 —
    // essa é a história verdadeira, e ela precisa de motivo.
    expect(temDivergencia({ quantidade: 10, quantidadeRecebida: 0 })).toBe(true);
  });

  it('a comparação é em milésimos', () => {
    // `0.7 - 0.4` é 0.29999999999999993 — um fio ABAIXO de 0.3. A comparação
    // ingênua chamaria isso de divergência e pediria motivo para uma carga que
    // chegou inteira. Com `0.1 + 0.2` este teste passava dos dois jeitos: aquele
    // valor cai ACIMA de 0.3, e o `<` ingênuo já devolvia false sozinho.
    expect(temDivergencia({ quantidade: 0.3, quantidadeRecebida: 0.7 - 0.4 })).toBe(false);
  });

  it('recebida corrompida é divergência, não carga perfeita', () => {
    // Sem a guarda isto devolvia false — "chegou tudo" — e a transferência
    // fechava sem ninguém olhar.
    expect(temDivergencia({ quantidade: 10, quantidadeRecebida: NaN })).toBe(true);
    expect(temDivergencia({ quantidade: 10, quantidadeRecebida: Infinity })).toBe(true);
  });
});

describe('statusAposRecebimento', () => {
  it('confirmar fecha a transferência mesmo com divergência', () => {
    // Não existe "recebida em parte" que continue aberta: o que não chegou
    // não vem depois. O documento fecha e a diferença fica registrada.
    expect(statusAposRecebimento([{ quantidade: 10, quantidadeRecebida: 7 }])).toBe('recebida');
  });

  it('confirmar com tudo zerado também fecha', () => {
    expect(statusAposRecebimento([{ quantidade: 10, quantidadeRecebida: 0 }])).toBe('recebida');
  });
});
