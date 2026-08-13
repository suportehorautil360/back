import { normalizarChassi } from './chassi.helper';

describe('normalizarChassi', () => {
  it('uppercase + trim + sem espaços', () => {
    expect(normalizarChassi(' 9bd 196 341A 000 0123 ')).toBe(
      '9BD196341A0000123',
    );
  });
  it('tolera undefined/null', () => {
    expect(normalizarChassi(undefined as unknown as string)).toBe('');
    expect(normalizarChassi(null as unknown as string)).toBe('');
  });
});
