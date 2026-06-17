import {
  formatProtocol,
  parseProtocolSeq,
} from './gerar-protocolo.helper';

describe('gerar-protocolo.helper', () => {
  it('parseia sequência do protocolo', () => {
    expect(parseProtocolSeq('OS-2026-047', 2026)).toBe(47);
    expect(parseProtocolSeq('OS-2025-001', 2026)).toBeNull();
  });

  it('formata protocolo com 3 dígitos', () => {
    expect(formatProtocol(2026, 7)).toBe('OS-2026-007');
  });
});
