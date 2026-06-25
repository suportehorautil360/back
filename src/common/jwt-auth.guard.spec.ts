import { UnauthorizedException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { JwtService } from '@nestjs/jwt';
import type { ExecutionContext } from '@nestjs/common';
import { JwtAuthGuard, type JwtPayload } from './jwt-auth.guard';

function makeContext(authHeader: string) {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ headers: { authorization: authHeader } }),
    }),
  } as unknown as ExecutionContext;
}

function makeGuard({
  secret = 'test-secret',
  verifyResult = undefined as JwtPayload | undefined,
  verifyError = undefined as Error | undefined,
} = {}) {
  const jwtService = {
    verifyAsync: jest.fn().mockImplementation(() => {
      if (verifyError) return Promise.reject(verifyError);
      return Promise.resolve(verifyResult);
    }),
  } as unknown as JwtService;

  const config = {
    get: jest.fn((key: string) => (key === 'JWT_SECRET' ? secret : undefined)),
  } as unknown as ConfigService;

  return new JwtAuthGuard(jwtService, config);
}

const validPayload: JwtPayload = {
  sub: 'user-1',
  oficinaId: 'of-1',
  prefeituraId: 'pref-1',
  credLevel: 'FULL',
};

describe('JwtAuthGuard', () => {
  it('sem header Authorization → UnauthorizedException', async () => {
    const guard = makeGuard();
    await expect(guard.canActivate(makeContext(''))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('token inválido/expirado → UnauthorizedException', async () => {
    const guard = makeGuard({ verifyError: new Error('jwt expired') });
    await expect(
      guard.canActivate(makeContext('Bearer token_invalido')),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('token válido → injeta payload no request e retorna true', async () => {
    const guard = makeGuard({ verifyResult: validPayload });
    const req = { headers: { authorization: 'Bearer token_valido' } } as any;
    const ctx = {
      switchToHttp: () => ({ getRequest: () => req }),
    } as unknown as ExecutionContext;

    const result = await guard.canActivate(ctx);

    expect(result).toBe(true);
    expect(req.jwtPayload).toMatchObject({ sub: 'user-1', credLevel: 'FULL' });
  });
});
