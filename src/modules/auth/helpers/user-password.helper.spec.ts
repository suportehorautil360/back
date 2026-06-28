import {
  assertNewPasswordStrength,
  resolveMustChangePassword,
  usesBcryptPassword,
} from './user-password.helper';

describe('user-password.helper', () => {
  it('resolveMustChangePassword lê mustChangePassword e firstLogin', () => {
    expect(resolveMustChangePassword(undefined)).toBe(false);
    expect(resolveMustChangePassword({ mustChangePassword: true })).toBe(true);
    expect(resolveMustChangePassword({ firstLogin: true })).toBe(true);
    expect(resolveMustChangePassword({ mustChangePassword: false })).toBe(false);
  });

  it('usesBcryptPassword detecta passwordHash', () => {
    expect(usesBcryptPassword({ senha: 'abc' })).toBe(false);
    expect(usesBcryptPassword({ passwordHash: '$2b$12$x' })).toBe(true);
  });

  it('assertNewPasswordStrength exige tamanho mínimo', () => {
    expect(() => assertNewPasswordStrength('curta')).toThrow(
      'A nova senha deve ter no mínimo 8 caracteres.',
    );
    expect(() => assertNewPasswordStrength('12345678')).not.toThrow();
  });
});
