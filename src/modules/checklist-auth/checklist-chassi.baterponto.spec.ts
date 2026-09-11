import { ChecklistChassiService } from './checklist-chassi.service';
import type { PrismaService } from '../../prisma/prisma.service';

/**
 * Mock mínimo de Prisma para `baterPonto`. O contador de NSR e o hash são
 * responsabilidade do servidor e já têm o caminho coberto pelo próprio
 * fluxo; aqui só precisamos ver o que chega no `create`.
 */
function servicoComPontoMockado() {
  const criados: Record<string, unknown>[] = [];

  const tx = {
    pontoNsrCounter: {
      upsert: jest.fn().mockResolvedValue({}),
      findUniqueOrThrow: jest
        .fn()
        .mockResolvedValue({ ultimo: 0, ultimoHash: null }),
      update: jest.fn().mockResolvedValue({}),
    },
    $executeRaw: jest.fn().mockResolvedValue(1),
    pontoRegistro: {
      create: jest.fn(({ data }: { data: Record<string, unknown> }) => {
        criados.push(data);
        return Promise.resolve({ ...data, createdAt: new Date() });
      }),
    },
  };

  const prisma = {
    company: {
      findFirst: jest.fn().mockResolvedValue({
        id: '4c2f78c1-0000-4000-8000-000000000001',
        legacyId: 'pref-1',
      }),
    },
    pontoRegistro: { findFirst: jest.fn().mockResolvedValue(null) },
    operator: { findFirst: jest.fn().mockResolvedValue(null) },
    $transaction: jest.fn((fn: (t: typeof tx) => unknown) =>
      Promise.resolve(fn(tx)),
    ),
  } as unknown as PrismaService;

  return { service: new ChecklistChassiService(prisma), criados };
}

describe('ChecklistChassiService.baterPonto — coordenada', () => {
  it('persiste a coordenada quando o aparelho informa', async () => {
    const { service, criados } = servicoComPontoMockado();
    await service.baterPonto(
      {
        name: 'Ana',
        photo: 'p1/selfie.jpg',
        prefeituraId: 'pref-1',
        timestampOriginal: '2026-09-06T10:00:00.000Z',
        tipo: 'entrada',
        latitude: -22.4149,
        longitude: -47.5651,
        precisaoMetros: 12,
      },
      'chave-1',
    );
    expect(criados[0]).toMatchObject({
      latitude: -22.4149,
      longitude: -47.5651,
      precisaoMetros: 12,
    });
  });

  it('grava a batida sem coordenada — GPS nunca impede o registro', async () => {
    // É o que o comentário do schema determina: empresa que não coleta, ou
    // aparelho sem sinal de GPS, continua batendo ponto.
    const { service, criados } = servicoComPontoMockado();
    await service.baterPonto(
      {
        name: 'Ana',
        photo: 'p2/selfie.jpg',
        prefeituraId: 'pref-1',
        timestampOriginal: '2026-09-06T10:00:00.000Z',
        tipo: 'entrada',
      },
      'chave-2',
    );
    expect(criados[0]).toMatchObject({
      latitude: null,
      longitude: null,
      precisaoMetros: null,
    });
  });

  it('aceita precisão fracionária do navegador e grava arredondada — coluna é Int', async () => {
    // navigator.geolocation informa accuracy como float (ex.: 12.3). A
    // validação do DTO precisa aceitar fração; quem arredonda é o service.
    const { service, criados } = servicoComPontoMockado();
    await service.baterPonto(
      {
        name: 'Ana',
        photo: 'p3/selfie.jpg',
        prefeituraId: 'pref-1',
        timestampOriginal: '2026-09-06T10:00:00.000Z',
        tipo: 'entrada',
        latitude: -22.4149,
        longitude: -47.5651,
        precisaoMetros: 12.3,
      },
      'chave-3',
    );
    expect(criados[0]).toMatchObject({ precisaoMetros: 12 });
  });
});
