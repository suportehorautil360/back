import {
  formatNumeroDocumento,
  parseNumeroDocumentoSeq,
  proximoNumeroDocumento,
} from './numero-documento.helper';

describe('numero-documento.helper', () => {
  it('formata com três dígitos mínimos e nunca trunca', () => {
    expect(formatNumeroDocumento('SC', 2026, 7)).toBe('SC-2026-007');
    expect(formatNumeroDocumento('OC', 2026, 1000)).toBe('OC-2026-1000');
  });

  it('só reconhece o prefixo e o ano pedidos', () => {
    expect(parseNumeroDocumentoSeq('SC', 'SC-2026-012', 2026)).toBe(12);
    expect(parseNumeroDocumentoSeq('SC', 'OC-2026-012', 2026)).toBeNull();
    expect(parseNumeroDocumentoSeq('SC', 'SC-2025-012', 2026)).toBeNull();
  });

  it('o próximo sai do MAIOR em número, não em texto — 1000 vem depois de 999', () => {
    expect(proximoNumeroDocumento('OC', 2026, ['OC-2026-999', 'OC-2026-1000', 'OC-2026-002'])).toBe('OC-2026-1001');
  });

  it('número fora do padrão é ignorado, não derruba a sequência', () => {
    expect(proximoNumeroDocumento('SC', 2026, ['SC-2026-X1', 'SC-2026-004'])).toBe('SC-2026-005');
    expect(proximoNumeroDocumento('SC', 2026, [])).toBe('SC-2026-001');
  });
});
