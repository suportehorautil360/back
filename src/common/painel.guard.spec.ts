import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PainelGuard, VERIFICADOR_DE_TOKEN_PAINEL } from './painel.guard';
import { PrismaService } from '../prisma/prisma.service';

type Verificador = (token: string) => Promise<{ sub: string }>;

function ctxCom(authorization?: string) {
  const req: Record<string, unknown> = {
    headers: authorization ? { authorization } : {},
  };
  return {
    req,
    ctx: {
      switchToHttp: () => ({ getRequest: () => req }),
    } as never,
  };
}

/** Prisma mínimo: só o que o guard consulta. */
function prismaCom(companyUser: unknown) {
  return {
    companyUser: { findUnique: jest.fn().mockResolvedValue(companyUser) },
  } as never;
}

const VERIFICA_OK: Verificador = async () => ({ sub: 'user-1' });

const ATIVO = {
  id: 'user-1',
  companyId: 'empresa-1',
  status: 'ACTIVE',
  company: { status: 'ACTIVE' },
  operator: { id: 'op-1', status: 'ativo', companyRoleId: 'cargo-1' },
};

describe('PainelGuard', () => {
  it('recusa sem cabeçalho Authorization', async () => {
    const { ctx } = ctxCom();
    const guard = new PainelGuard(prismaCom(ATIVO), VERIFICA_OK);
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('recusa token que não verifica', async () => {
    const { ctx } = ctxCom('Bearer qualquer');
    const quebra: Verificador = async () => {
      throw new Error('assinatura inválida');
    };
    const guard = new PainelGuard(prismaCom(ATIVO), quebra);
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('recusa quando o sub não é CompanyUser da plataforma', async () => {
    const { ctx } = ctxCom('Bearer t');
    const guard = new PainelGuard(prismaCom(null), VERIFICA_OK);
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it.each([
    ['vínculo inativo', { ...ATIVO, status: 'INACTIVE' }],
    ['empresa inativa', { ...ATIVO, company: { status: 'INACTIVE' } }],
    [
      'funcionário inativo',
      { ...ATIVO, operator: { ...ATIVO.operator, status: 'inativo' } },
    ],
  ])('recusa com %s', async (_nome, linha) => {
    const { ctx } = ctxCom('Bearer t');
    const guard = new PainelGuard(prismaCom(linha), VERIFICA_OK);
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('injeta req.painel quando tudo está ativo', async () => {
    const { ctx, req } = ctxCom('Bearer t');
    const guard = new PainelGuard(prismaCom(ATIVO), VERIFICA_OK);
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(req.painel).toEqual({
      companyUserId: 'user-1',
      companyId: 'empresa-1',
      operatorId: 'op-1',
      companyRoleId: 'cargo-1',
    });
  });

  // Gestor que não é funcionário: entra para LER, sem identidade de execução.
  it('aceita CompanyUser sem Operator, com operatorId nulo', async () => {
    const { ctx, req } = ctxCom('Bearer t');
    const guard = new PainelGuard(
      prismaCom({ ...ATIVO, operator: null }),
      VERIFICA_OK,
    );
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect((req.painel as { operatorId: string | null }).operatorId).toBeNull();
  });

  // Prova que o Nest resolve o guard de verdade. O construtor original do
  // plano recebia `verificador?: VerificadorDeToken` sem @Inject: como
  // VerificadorDeToken é alias de tipo função, o TypeScript emite `Function`
  // em design:paramtypes, o Nest tenta achar um provider pra esse tipo e a
  // aplicação não sobe. Só instanciar o guard à mão (como os testes acima
  // fazem) nunca pegaria isso — por isso este teste compila um TestingModule
  // de verdade e busca o guard pelo container.
  it('resolve pelo container do Nest sem provider de verificador registrado', async () => {
    // Cenário real de produção: ninguém registra provider pro token do
    // verificador, e o construtor cai no fallback `verificadorSupabase()`.
    // Ele só monta o `createRemoteJWKSet` (não busca a JWKS na rede), então
    // basta a URL ter sintaxe válida — variáveis reais não são necessárias.
    const antes = {
      url: process.env.SUPABASE_URL,
      jwks: process.env.SUPABASE_JWKS_URL,
    };
    process.env.SUPABASE_URL = 'https://exemplo-de-teste.supabase.co';
    process.env.SUPABASE_JWKS_URL =
      'https://exemplo-de-teste.supabase.co/auth/v1/.well-known/jwks.json';

    try {
      const prismaMock = prismaCom(ATIVO);

      const moduleRef = await Test.createTestingModule({
        providers: [
          PainelGuard,
          { provide: PrismaService, useValue: prismaMock },
        ],
      }).compile();

      const guard = moduleRef.get(PainelGuard);
      expect(guard).toBeInstanceOf(PainelGuard);
    } finally {
      process.env.SUPABASE_URL = antes.url;
      process.env.SUPABASE_JWKS_URL = antes.jwks;
    }
  });

  // Mesma prova, mas registrando o token opcional — cobre o caminho que os
  // outros testes deste arquivo exercitam manualmente com `new PainelGuard`.
  it('resolve pelo container do Nest usando o provider do verificador', async () => {
    const { ctx, req } = ctxCom('Bearer t');
    const prismaMock = prismaCom(ATIVO);

    const moduleRef = await Test.createTestingModule({
      providers: [
        PainelGuard,
        { provide: PrismaService, useValue: prismaMock },
        { provide: VERIFICADOR_DE_TOKEN_PAINEL, useValue: VERIFICA_OK },
      ],
    }).compile();

    const guard = moduleRef.get(PainelGuard);
    expect(guard).toBeInstanceOf(PainelGuard);
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(req.painel).toEqual({
      companyUserId: 'user-1',
      companyId: 'empresa-1',
      operatorId: 'op-1',
      companyRoleId: 'cargo-1',
    });
  });
});
