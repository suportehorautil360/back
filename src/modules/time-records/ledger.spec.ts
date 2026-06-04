import { calcularHash, PayloadLedger } from './ledger';

const base: PayloadLedger = {
  prefeituraId: 'pref-1',
  identificador: '12345678901',
  tipo: 'entrada',
  timestampOriginal: '2026-05-25T13:05:00.000Z',
  registro: 'original',
};

describe('ledger.calcularHash', () => {
  it('é determinístico para o mesmo registro e hash anterior', () => {
    expect(calcularHash(1, base, '')).toBe(calcularHash(1, base, ''));
  });

  it('produz hash hex de 64 chars (SHA-256)', () => {
    expect(calcularHash(1, base, '')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('muda se qualquer campo do registro muda', () => {
    const h0 = calcularHash(1, base, '');
    expect(calcularHash(2, base, '')).not.toBe(h0); // NSR
    expect(calcularHash(1, { ...base, tipo: 'saida' }, '')).not.toBe(h0);
    expect(
      calcularHash(1, { ...base, timestampOriginal: '2026-05-25T14:00:00Z' }, ''),
    ).not.toBe(h0);
    expect(calcularHash(1, { ...base, registro: 'ajuste' }, '')).not.toBe(h0);
  });

  it('encadeia: o mesmo registro com hash anterior diferente gera hash diferente', () => {
    const a = calcularHash(2, base, 'aaa');
    const b = calcularHash(2, base, 'bbb');
    expect(a).not.toBe(b);
  });
});
