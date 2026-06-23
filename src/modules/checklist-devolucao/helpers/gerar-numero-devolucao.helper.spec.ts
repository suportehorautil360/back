import {
  formatNumeroDevolucao,
  parseNumeroDevolucaoSeq,
} from './gerar-numero-devolucao.helper';

describe('gerar-numero-devolucao.helper', () => {
  it('formata número CHD', () => {
    expect(formatNumeroDevolucao(2026, 1)).toBe('CHD-2026-0001');
    expect(formatNumeroDevolucao(2026, 48)).toBe('CHD-2026-0048');
  });

  it('parseia sequência do ano', () => {
    expect(parseNumeroDevolucaoSeq('CHD-2026-0001', 2026)).toBe(1);
    expect(parseNumeroDevolucaoSeq('CHD-2025-0010', 2026)).toBeNull();
  });
});
