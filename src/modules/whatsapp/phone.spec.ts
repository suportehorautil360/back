import { formatarJid, formatarNumeroEvolution, numeroValido, prepararMediaEvolution } from './phone';

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

  it('mantém E.164 com + (BR) sem duplicar o DDI', () => {
    expect(formatarJid('+55 67 99999-9999')).toBe(
      '5567999999999@s.whatsapp.net',
    );
  });

  it('mantém E.164 internacional (US) sem prefixar 55', () => {
    expect(formatarJid('+1 415 555 1234')).toBe('14155551234@s.whatsapp.net');
  });

  it('numeroValido exige ao menos 10 dígitos', () => {
    expect(numeroValido('67 99999-9999')).toBe(true);
    expect(numeroValido('123')).toBe(false);
    expect(numeroValido('')).toBe(false);
    expect(numeroValido(null)).toBe(false);
  });

  it('formatarNumeroEvolution retorna só dígitos com DDI', () => {
    expect(formatarNumeroEvolution('67 99999-9999')).toBe('5567999999999');
    expect(formatarNumeroEvolution('+55 67 99999-9999')).toBe('5567999999999');
  });

  it('prepararMediaEvolution remove prefixo data URL', () => {
    const { media, mimetype } = prepararMediaEvolution(
      'data:image/png;base64,ABC123',
    );
    expect(mimetype).toBe('image/png');
    expect(media).toBe('ABC123');
  });

  it('prepararMediaEvolution mantém URL http', () => {
    const url = 'https://example.com/foto.jpg';
    expect(prepararMediaEvolution(url)).toEqual({
      media: url,
      mimetype: 'image/jpeg',
    });
  });
});
