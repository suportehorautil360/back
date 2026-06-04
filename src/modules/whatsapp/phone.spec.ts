import { formatarJid, numeroValido } from './phone';

describe('whatsapp/phone', () => {
  it('formata número com DDD (11 díg.) prefixando o DDI 55', () => {
    expect(formatarJid('67 99999-9999')).toBe('5567999999999@s.whatsapp.net');
  });

  it('formata fixo (10 díg.) prefixando o DDI 55', () => {
    expect(formatarJid('11 3333-4444')).toBe('551133334444@s.whatsapp.net');
  });

  it('mantém número que já tem DDI', () => {
    expect(formatarJid('5567999999999')).toBe('5567999999999@s.whatsapp.net');
  });

  it('numeroValido exige ao menos 10 dígitos', () => {
    expect(numeroValido('67 99999-9999')).toBe(true);
    expect(numeroValido('123')).toBe(false);
    expect(numeroValido('')).toBe(false);
    expect(numeroValido(null)).toBe(false);
  });
});
