import {
  ForbiddenException,
  UnauthorizedException,
  type ExecutionContext,
} from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { JwtService } from '@nestjs/jwt';
import { ComboistaGuard } from './comboista.guard';

type Payload = Record<string, unknown>;

function ctxCom(
  authorization: string,
  params: Record<string, string>,
): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ headers: { authorization }, params }),
    }),
  } as unknown as ExecutionContext;
}

function guardCom(verify: () => Promise<Payload>) {
  const jwt = {
    verifyAsync: jest.fn(verify),
  } as unknown as JwtService;
  const config = {
    get: jest.fn(() => 'segredo'),
  } as unknown as ConfigService;
  return new ComboistaGuard(jwt, config);
}

const ROTA = { prefeituraId: 'pref-1', motoristaId: 'func-1' };

describe('ComboistaGuard', () => {
  it('sem token → Unauthorized', async () => {
    const guard = guardCom(() => Promise.resolve({}));
    await expect(guard.canActivate(ctxCom('', ROTA))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('token inválido → Unauthorized', async () => {
    const guard = guardCom(() => Promise.reject(new Error('bad')));
    await expect(
      guard.canActivate(ctxCom('Bearer x', ROTA)),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('prefeitura do token diferente da rota → Forbidden', async () => {
    const guard = guardCom(() =>
      Promise.resolve({ prefeituraId: 'outra', funcionarioId: 'func-1' }),
    );
    await expect(
      guard.canActivate(ctxCom('Bearer x', ROTA)),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('funcionário do token diferente do motorista da rota → Forbidden', async () => {
    const guard = guardCom(() =>
      Promise.resolve({ prefeituraId: 'pref-1', funcionarioId: 'outro' }),
    );
    await expect(
      guard.canActivate(ctxCom('Bearer x', ROTA)),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('prefeitura + funcionário batem → libera', async () => {
    const guard = guardCom(() =>
      Promise.resolve({ prefeituraId: 'pref-1', funcionarioId: 'func-1' }),
    );
    await expect(guard.canActivate(ctxCom('Bearer x', ROTA))).resolves.toBe(
      true,
    );
  });

  it('tipo admin → cross-tenant liberado', async () => {
    const guard = guardCom(() =>
      Promise.resolve({ tipo: 'admin', prefeituraId: 'qualquer' }),
    );
    await expect(guard.canActivate(ctxCom('Bearer x', ROTA))).resolves.toBe(
      true,
    );
  });
});
