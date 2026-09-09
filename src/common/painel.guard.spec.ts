import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PainelGuard, VERIFICADOR_DE_TOKEN_PAINEL } from './painel.guard';
import {
  MODULO_COMERCIAL_KEY,
  type ModuloComercialMeta,
} from './modulo-comercial.decorator';
import { PrismaService } from '../prisma/prisma.service';

type Verificador = (token: string) => Promise<{ sub: string }>;

/**
 * `modulo`, quando informado, grava a metadata de `@ModuloComercial` de
 * verdade (via `Reflect.defineMetadata`, o mesmo par que `SetMetadata` grava
 * e que o guard lê com `Reflect.getMetadata`) no `getHandler()` do contexto
 * fake — exercita o decorator + a leitura real, não um atalho de teste.
 * Sem `modulo`, o handler fica sem metadata: é o caso das rotas de hoje que
 * não usam o gate comercial/cargo.
 */
function ctxCom(authorization?: string, modulo?: ModuloComercialMeta) {
  const req: Record<string, unknown> = {
    headers: authorization ? { authorization } : {},
  };
  const handler = () => {};
  const classe = class {};
  if (modulo) {
    Reflect.defineMetadata(MODULO_COMERCIAL_KEY, modulo, handler);
  }
  return {
    req,
    ctx: {
      switchToHttp: () => ({ getRequest: () => req }),
      getHandler: () => handler,
      getClass: () => classe,
    } as never,
  };
}

type FeatureRow = { companyId: string; featureKey: string; enabled: boolean };
type CompanyRoleAccessRow = {
  companyRoleId: string;
  groupKey: string;
  enabled: boolean;
};
type CompanyRoleRow = { id: string; key: string };
type RoleAccessRow = { roleKey: string; groupKey: string; enabled: boolean };

/**
 * Prisma mínimo: só o que o guard consulta. As quatro tabelas do gate
 * comercial/cargo são arrays em memória filtrados pelo `where` de verdade que
 * o guard manda — não um mock com retorno fixo, que esvaziaria a suíte em
 * silêncio (achado Critical anterior neste trabalho).
 */
function prismaCom(
  companyUser: unknown,
  tabelas?: {
    features?: FeatureRow[];
    companyRoleAccess?: CompanyRoleAccessRow[];
    companyRoles?: CompanyRoleRow[];
    roleAccess?: RoleAccessRow[];
  },
) {
  const features = tabelas?.features ?? [];
  const companyRoleAccess = tabelas?.companyRoleAccess ?? [];
  const companyRoles = tabelas?.companyRoles ?? [];
  const roleAccess = tabelas?.roleAccess ?? [];

  return {
    companyUser: { findUnique: jest.fn().mockResolvedValue(companyUser) },
    companyFeature: {
      findFirst: jest.fn(
        async ({
          where,
        }: {
          where: { companyId: string; feature: { key: string } };
        }) => {
          const linha = features.find(
            (f) =>
              f.companyId === where.companyId &&
              f.featureKey === where.feature.key,
          );
          return linha ? { enabled: linha.enabled } : null;
        },
      ),
    },
    companyRoleAccessGroup: {
      findFirst: jest.fn(
        async ({
          where,
        }: {
          where: { companyRoleId: string; group: { key: string } };
        }) => {
          const linha = companyRoleAccess.find(
            (r) =>
              r.companyRoleId === where.companyRoleId &&
              r.groupKey === where.group.key,
          );
          return linha ? { enabled: linha.enabled } : null;
        },
      ),
    },
    companyRole: {
      findUnique: jest.fn(async ({ where }: { where: { id: string } }) => {
        const linha = companyRoles.find((r) => r.id === where.id);
        return linha ? { key: linha.key } : null;
      }),
    },
    roleAccessGroup: {
      findFirst: jest.fn(
        async ({
          where,
        }: {
          where: { role: { key: string }; group: { key: string } };
        }) => {
          const linha = roleAccess.find(
            (r) =>
              r.roleKey === where.role.key && r.groupKey === where.group.key,
          );
          return linha ? { enabled: linha.enabled } : null;
        },
      ),
    },
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

// Gate comercial (feature contratada) + gate de cargo (grupo de acesso).
// Só roda quando a rota carrega `@ModuloComercial` — é o que `ctxCom` grava
// de verdade no `getHandler()` do contexto fake.
describe('PainelGuard — gate comercial e de cargo', () => {
  const MODULO_MECANICA: ModuloComercialMeta = {
    featureKey: 'mecanica',
    accessGroupKey: 'mecanica',
  };

  it('recusa quando a empresa não contratou a feature', async () => {
    const { ctx } = ctxCom('Bearer t', MODULO_MECANICA);
    const guard = new PainelGuard(
      prismaCom(ATIVO, {
        features: [], // sem linha em company_features = desligado
        companyRoles: [{ id: 'cargo-1', key: 'mecanico' }],
        roleAccess: [{ roleKey: 'mecanico', groupKey: 'mecanica', enabled: true }],
      }),
      VERIFICA_OK,
    );
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('recusa quando a empresa contratou mas o cargo não libera o módulo', async () => {
    const { ctx } = ctxCom('Bearer t', MODULO_MECANICA);
    const guard = new PainelGuard(
      prismaCom(ATIVO, {
        features: [{ companyId: 'empresa-1', featureKey: 'mecanica', enabled: true }],
        companyRoles: [{ id: 'cargo-1', key: 'mecanico' }],
        roleAccess: [], // matriz padrão não libera 'mecanica' pro cargo
      }),
      VERIFICA_OK,
    );
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('passa quando a empresa contratou e o cargo libera o módulo', async () => {
    const { ctx } = ctxCom('Bearer t', MODULO_MECANICA);
    const guard = new PainelGuard(
      prismaCom(ATIVO, {
        features: [{ companyId: 'empresa-1', featureKey: 'mecanica', enabled: true }],
        companyRoles: [{ id: 'cargo-1', key: 'mecanico' }],
        roleAccess: [{ roleKey: 'mecanico', groupKey: 'mecanica', enabled: true }],
      }),
      VERIFICA_OK,
    );
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  it('recusa com override por empresa desligando módulo que a matriz padrão libera', async () => {
    const { ctx } = ctxCom('Bearer t', MODULO_MECANICA);
    const guard = new PainelGuard(
      prismaCom(ATIVO, {
        features: [{ companyId: 'empresa-1', featureKey: 'mecanica', enabled: true }],
        companyRoles: [{ id: 'cargo-1', key: 'mecanico' }],
        // Matriz padrão libera...
        roleAccess: [{ roleKey: 'mecanico', groupKey: 'mecanica', enabled: true }],
        // ...mas o override desta empresa desliga pro cargo dela.
        companyRoleAccess: [
          { companyRoleId: 'cargo-1', groupKey: 'mecanica', enabled: false },
        ],
      }),
      VERIFICA_OK,
    );
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('passa com override por empresa ligando módulo que a matriz padrão não libera', async () => {
    const { ctx } = ctxCom('Bearer t', MODULO_MECANICA);
    const guard = new PainelGuard(
      prismaCom(ATIVO, {
        features: [{ companyId: 'empresa-1', featureKey: 'mecanica', enabled: true }],
        companyRoles: [{ id: 'cargo-1', key: 'mecanico' }],
        // Matriz padrão não libera...
        roleAccess: [],
        // ...mas o override desta empresa liga pro cargo dela.
        companyRoleAccess: [
          { companyRoleId: 'cargo-1', groupKey: 'mecanica', enabled: true },
        ],
      }),
      VERIFICA_OK,
    );
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  // As rotas sem `@ModuloComercial` continuam só com os três checks de
  // `status` — nenhuma tabela nova é sequer consultada.
  it('rota sem @ModuloComercial ignora o gate e passa sem consultar feature/cargo', async () => {
    const { ctx } = ctxCom('Bearer t');
    const prisma = prismaCom(ATIVO, { features: [], roleAccess: [] });
    const guard = new PainelGuard(prisma, VERIFICA_OK);
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(
      (prisma as unknown as { companyFeature: { findFirst: jest.Mock } })
        .companyFeature.findFirst,
    ).not.toHaveBeenCalled();
  });
});
