import {
  formatNumeroChegada,
  parseNumeroChegadaSeq,
} from './gerar-numero-chegada.helper';

describe('gerar-numero-chegada.helper', () => {
  it('formata número com 4 dígitos', () => {
    expect(formatNumeroChegada(2026, 1)).toBe('CHE-2026-0001');
    expect(formatNumeroChegada(2026, 48)).toBe('CHE-2026-0048');
  });

  it('parseia sequência do número', () => {
    expect(parseNumeroChegadaSeq('CHE-2026-0001', 2026)).toBe(1);
    expect(parseNumeroChegadaSeq('CHE-2025-0010', 2026)).toBeNull();
  });
});
