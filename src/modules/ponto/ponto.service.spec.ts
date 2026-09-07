jest.mock('../../prisma/prisma.service', () => ({
  PrismaService: class PrismaService {},
}));

jest.mock('../../common/prisma/company-resolver', () => {
  const actual = jest.requireActual<
    typeof import('../../common/prisma/company-resolver')
  >('../../common/prisma/company-resolver');
  return { ...actual, resolverCompanyId: jest.fn() };
});

import { NotFoundException } from '@nestjs/common';
import { PontoService } from './ponto.service';
import { resolverCompanyId } from '../../common/prisma/company-resolver';

const resolveCompany = jest.mocked(resolverCompanyId);

const COMPANY_ID = 'company-uuid-1';
const DE = new Date('2026-09-06T03:00:00.000Z');
const ATE = new Date('2026-09-07T03:00:00.000Z');

function makePrisma(operatorRow: { id: string; cpf: string | null } | null) {
  const operatorFindFirst = jest.fn().mockResolvedValue(operatorRow);
  const pontoRegistroFindMany = jest.fn().mockResolvedValue([]);
  const prisma = {
    operator: { findFirst: operatorFindFirst },
    pontoRegistro: { findMany: pontoRegistroFindMany },
  };
  return {
    prisma: prisma as unknown as ConstructorParameters<typeof PontoService>[0],
    operatorFindFirst,
    pontoRegistroFindMany,
  };
}

describe('PontoService.registrosDoPeriodo', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resolveCompany.mockResolvedValue(COMPANY_ID);
  });

  it('resolve o operador quando funcionarioId é um legacyId em formato UUID', async () => {
    // Este é o formato mais comum: cadastro que casou com o legado emite
    // `legacyId` como o próprio UUID da PK. Tem de casar tanto por `id`
    // quanto por `legacyId`, porque não dá pra saber qual dos dois é sem
    // consultar.
    const legacyIdUuid = '11111111-1111-1111-1111-111111111111';
    const { prisma, operatorFindFirst } = makePrisma({
      id: 'operator-pk-1',
      cpf: '12345678901',
    });
    const service = new PontoService(prisma);

    await service.registrosDoPeriodo(legacyIdUuid, 'prefeitura-1', DE, ATE);

    expect(operatorFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          companyId: COMPANY_ID,
          OR: [{ id: legacyIdUuid }, { legacyId: legacyIdUuid }],
        },
      }),
    );
  });

  it('resolve o operador quando funcionarioId é um legacyId não-UUID (Firestore)', async () => {
    // Cadastro que veio do Firestore sem casar com o legado: `legacyId` é o
    // docId, uma string qualquer. Não pode entrar na cláusula `id`, que é
    // coluna `@db.Uuid` — senão o Postgres derruba a query com P2007 antes
    // de sequer olhar pro OR.
    const legacyIdFirestore = 'aBcD1234FirestoreDocId';
    const { prisma, operatorFindFirst } = makePrisma({
      id: 'operator-pk-2',
      cpf: null,
    });
    const service = new PontoService(prisma);

    await service.registrosDoPeriodo(
      legacyIdFirestore,
      'prefeitura-1',
      DE,
      ATE,
    );

    expect(operatorFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          companyId: COMPANY_ID,
          legacyId: legacyIdFirestore,
        },
      }),
    );
    const where = (operatorFindFirst.mock.calls[0] as [{ where: object }])[0]
      .where;
    expect(where).not.toHaveProperty('OR');
    expect(where).not.toHaveProperty('id');
  });

  it('lança NotFoundException quando o operador não existe nesta empresa', async () => {
    const { prisma } = makePrisma(null);
    const service = new PontoService(prisma);

    await expect(
      service.registrosDoPeriodo('qualquer-id', 'prefeitura-1', DE, ATE),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('devolve o hash de cada registro — o CRPT precisa dele', async () => {
    // Sem o hash o app só emite comprovante de batida feita naquele
    // aparelho. A rota já recorta pela pessoa do token (sem parâmetro de
    // CPF), então expor o hash aqui dá a cada um só o próprio.
    const { prisma, pontoRegistroFindMany } = makePrisma({
      id: 'operator-pk-1',
      cpf: '12345678901',
    });
    const service = new PontoService(prisma);

    await service.registrosDoPeriodo('op-1', 'prefeitura-1', DE, ATE);

    expect(pontoRegistroFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.objectContaining({ hash: true }),
      }),
    );
  });
});
