import { BadRequestException } from '@nestjs/common';

export const MIN_NEW_PASSWORD_LENGTH = 8;

export function resolveMustChangePassword(
  userData: FirebaseFirestore.DocumentData | undefined,
): boolean {
  if (userData?.mustChangePassword === true) return true;
  if (userData?.firstLogin === true) return true;
  return false;
}

export function assertNewPasswordStrength(password: string): void {
  if (password.length < MIN_NEW_PASSWORD_LENGTH) {
    throw new BadRequestException(
      `A nova senha deve ter no mínimo ${MIN_NEW_PASSWORD_LENGTH} caracteres.`,
    );
  }
}

export function usesBcryptPassword(
  userData: FirebaseFirestore.DocumentData | undefined,
): boolean {
  return typeof userData?.passwordHash === 'string' && !!userData.passwordHash;
}
