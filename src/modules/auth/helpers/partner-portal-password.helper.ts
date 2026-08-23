import * as bcrypt from 'bcrypt';
import { hashSenhaOperacional } from '../../parceiros/helpers/parceiro-login.helper';

export const BCRYPT_ROUNDS = 12;
export const TIMING_DUMMY_BCRYPT = bcrypt.hashSync('_timing_', BCRYPT_ROUNDS);

export function isBcryptHash(stored: string): boolean {
  return stored.startsWith('$2');
}

export async function verifyPortalPassword(
  password: string,
  senhaHash: string,
): Promise<boolean> {
  if (!senhaHash || senhaHash === TIMING_DUMMY_BCRYPT) {
    await bcrypt.compare(password, TIMING_DUMMY_BCRYPT);
    return false;
  }

  if (isBcryptHash(senhaHash)) {
    return bcrypt.compare(password, senhaHash);
  }

  return hashSenhaOperacional(password) === senhaHash;
}

export async function hashPortalPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

export function isPortalUserActive(status: string | null | undefined): boolean {
  const normalized = (status ?? '').trim().toLowerCase();
  if (!normalized) return true;
  return normalized === 'ativo' || normalized === 'active';
}
