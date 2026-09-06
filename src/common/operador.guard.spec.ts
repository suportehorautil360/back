import { ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { OperadorGuard } from './operador.guard';

const SEGREDO = 'segredo-de-teste';

function ctx(authorization?: string): ExecutionContext {
  const req: Record<string, unknown> = { headers: authorization ? { authorization } : {} };
  return {
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
}

function guard(): { g: OperadorGuard; jwt: JwtService } {
  const jwt = new JwtService({});
  const config = { get: (k: string) => (k === 'JWT_SECRET' ? SEGREDO : undefined) } as ConfigService;
  return { g: new OperadorGuard(jwt, config), jwt };
}

describe('OperadorGuard', () => {
  it('aceita token de operador', async () => {
    const { g, jwt } = guard();
    const token = await jwt.signAsync(
      { sub: 'ana901', tipo: 'operador', prefeituraId: 'pref-1', funcionarioId: 'f-1' },
      { secret: SEGREDO },
    );
    await expect(g.canActivate(ctx(`Bearer ${token}`))).resolves.toBe(true);
  });

  it('recusa token de gestor do portal, que é assinado pelo MESMO segredo', async () => {
    // Sem esta checagem um gestor leria o ponto de qualquer pessoa da empresa:
    // a assinatura dele é válida, só o papel é outro.
    const { g, jwt } = guard();
    const token = await jwt.signAsync(
      { sub: 'gestor-1', perfil: 'gestor', vinculo: 'prefeitura', prefeituraId: 'pref-1' },
      { secret: SEGREDO },
    );
    await expect(g.canActivate(ctx(`Bearer ${token}`))).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('recusa token de operador sem funcionarioId', async () => {
    const { g, jwt } = guard();
    const token = await jwt.signAsync({ sub: 'x', tipo: 'operador', prefeituraId: 'pref-1' }, { secret: SEGREDO });
    await expect(g.canActivate(ctx(`Bearer ${token}`))).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('recusa sem cabeçalho', async () => {
    const { g } = guard();
    await expect(g.canActivate(ctx())).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('recusa assinatura de outro segredo', async () => {
    const { g } = guard();
    const outro = new JwtService({});
    const token = await outro.signAsync(
      { sub: 'x', tipo: 'operador', prefeituraId: 'p', funcionarioId: 'f' },
      { secret: 'outro-segredo' },
    );
    await expect(g.canActivate(ctx(`Bearer ${token}`))).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('anexa o payload em req.operador', async () => {
    const { g, jwt } = guard();
    const token = await jwt.signAsync(
      { sub: 'ana901', tipo: 'operador', prefeituraId: 'pref-1', funcionarioId: 'f-1' },
      { secret: SEGREDO },
    );
    const c = ctx(`Bearer ${token}`);
    await g.canActivate(c);
    const req = c.switchToHttp().getRequest() as { operador?: { funcionarioId: string } };
    expect(req.operador?.funcionarioId).toBe('f-1');
  });
});
