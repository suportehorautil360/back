// PrismaService importa a client ESM do Prisma (`import.meta.url`) que o Jest
// atual (CJS via ts-jest) não carrega. Stub antes de qualquer import da service
// evita o require em cadeia. Cada teste injeta seu próprio mock via constructor.
jest.mock('../../prisma/prisma.service', () => ({ PrismaService: class {} }));

import { FeatureFlagsService } from './feature-flags.service';
import type { PrismaService } from '../../prisma/prisma.service';

type CompanyRow = { id: string };
type CompanyFeatureRow = { enabled: boolean; feature: { key: string } | null };
type FeatureRow = { id: string; key: string };

function makePrisma(opts: {
  company?: CompanyRow | null;
  companyByLegacy?: CompanyRow | null;
  companyFeatures?: CompanyFeatureRow[];
  features?: FeatureRow[];
}) {
  const findUniqueCompany = jest.fn().mockImplementation(({ where }) => {
    if ('id' in where) return Promise.resolve(opts.company ?? null);
    if ('legacyId' in where)
      return Promise.resolve(opts.companyByLegacy ?? null);
    return Promise.resolve(null);
  });

  const findManyCompanyFeature = jest
    .fn()
    .mockResolvedValue(opts.companyFeatures ?? []);
  const upsertCompanyFeature = jest.fn().mockResolvedValue(undefined);
  const findManyFeature = jest.fn().mockResolvedValue(opts.features ?? []);
  const runTransaction = jest.fn().mockImplementation((calls: unknown[]) =>
    Promise.all(calls),
  );

  const prisma = {
    company: { findUnique: findUniqueCompany },
    companyFeature: {
      findMany: findManyCompanyFeature,
      upsert: upsertCompanyFeature,
    },
    feature: { findMany: findManyFeature },
    $transaction: runTransaction,
  } as unknown as PrismaService;

  return { prisma, upsertCompanyFeature, findUniqueCompany };
}

describe('FeatureFlagsService', () => {
  it('obter devolve {} quando empresa nao existe', async () => {
    const { prisma } = makePrisma({});
    const svc = new FeatureFlagsService(prisma);
    expect(await svc.obter('a6a03cde-f0a9-402b-9c4d-812033f76f57')).toEqual({});
  });

  it('obter devolve {} quando empresa existe mas sem flags', async () => {
    const { prisma } = makePrisma({
      company: { id: '00000000-0000-0000-0000-000000000001' },
      companyFeatures: [],
    });
    expect(
      await new FeatureFlagsService(prisma).obter(
        '00000000-0000-0000-0000-000000000001',
      ),
    ).toEqual({});
  });

  it('obter mapeia CompanyFeature -> { key: enabled }', async () => {
    const { prisma } = makePrisma({
      company: { id: '00000000-0000-0000-0000-000000000001' },
      companyFeatures: [
        { enabled: true, feature: { key: 'ponto' } },
        { enabled: false, feature: { key: 'abastecimento' } },
      ],
    });
    expect(
      await new FeatureFlagsService(prisma).obter(
        '00000000-0000-0000-0000-000000000001',
      ),
    ).toEqual({ ponto: true, abastecimento: false });
  });

  it('obter aceita legacyId (docId Firestore antigo)', async () => {
    const { prisma } = makePrisma({
      companyByLegacy: { id: '00000000-0000-0000-0000-000000000001' },
      companyFeatures: [{ enabled: true, feature: { key: 'ponto' } }],
    });
    // "a6a03cde-..." é um legacyId, não é UUID Postgres real da empresa.
    const flags = await new FeatureFlagsService(prisma).obter('legacy-abc');
    expect(flags).toEqual({ ponto: true });
  });

  it('ativo=false por padrão (opt-in) quando flag ausente', async () => {
    const { prisma } = makePrisma({
      company: { id: '00000000-0000-0000-0000-000000000001' },
      companyFeatures: [],
    });
    const ativo = await new FeatureFlagsService(prisma).ativo(
      '00000000-0000-0000-0000-000000000001',
      'ponto',
    );
    expect(ativo).toBe(false);
  });

  it('salvar faz upsert só das keys que existem no catálogo', async () => {
    const { prisma, upsertCompanyFeature } = makePrisma({
      company: { id: '00000000-0000-0000-0000-000000000001' },
      features: [
        { id: 'feat-1', key: 'ponto' },
        // "desconhecida" NÃO existe no catálogo — deve ser ignorada com warning.
      ],
    });
    await new FeatureFlagsService(prisma).salvar({
      prefeituraId: '00000000-0000-0000-0000-000000000001',
      flags: { ponto: true, desconhecida: true },
    });
    expect(upsertCompanyFeature).toHaveBeenCalledTimes(1);
    expect(upsertCompanyFeature).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          companyId_featureId: {
            companyId: '00000000-0000-0000-0000-000000000001',
            featureId: 'feat-1',
          },
        },
        update: { enabled: true },
      }),
    );
  });
});
