import {
  calcularHashPonto,
  formatTimestampForLedger,
} from './ponto-ledger.helper';

describe('ponto-ledger.helper', () => {
  it('formata timestamp UTC como a RPC Postgres', () => {
    expect(formatTimestampForLedger('2026-08-16T21:52:25.996Z')).toBe(
      '2026-08-16T21:52:25.996Z',
    );
  });

  it('hash encadeia com payload canônico', () => {
    const h1 = calcularHashPonto(
      1,
      'a6a03cde-f0a9-402b-9c4d-812033f76f57',
      'Maicon Silva',
      'entrada',
      '2026-08-16T21:52:25.996Z',
      '',
    );
    const h2 = calcularHashPonto(
      2,
      'a6a03cde-f0a9-402b-9c4d-812033f76f57',
      'Maicon Silva',
      'saida',
      '2026-08-16T22:00:00.000Z',
      h1,
    );
    expect(h1).toHaveLength(64);
    expect(h2).toHaveLength(64);
    expect(h2).not.toBe(h1);
  });
});
