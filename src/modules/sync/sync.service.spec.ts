import { NotFoundException } from '@nestjs/common';

import { SyncService } from './sync.service';

/**
 * O app manda o `legacyId` da empresa (é o que o resolver-chassi devolve),
 * mas `equipments.company_id` guarda o UUID do Postgres. Os dois se parecem —
 * ambos são UUID — então consultar sem resolver não estoura: simplesmente
 * devolve zero equipamento, e o operador fica sem frota sem nenhum erro.
 */
describe('SyncService', () => {
  function prismaFalso(idResolvido: string | null) {
    return {
      company: {
        findUnique: jest.fn(async () =>
          idResolvido ? { id: idResolvido } : null,
        ),
      },
      equipment: { findMany: jest.fn(async () => []) },
      syncTombstone: { findMany: jest.fn(async () => []) },
    };
  }

  it('resolve o legacyId da empresa antes de consultar equipamentos', async () => {
    const prisma = prismaFalso('4c2f78c1-uuid-real');
    const service = new SyncService(prisma as never);

    await service.puxar('6efff67a-legacy-do-app', 'equipamentos');

    const where = prisma.equipment.findMany.mock.calls[0][0].where;
    expect(where.companyId).toBe('4c2f78c1-uuid-real');
  });

  it('empresa inexistente é 404, não lista vazia', async () => {
    // Devolver [] faria o app apagar o espelho inteiro achando que a frota
    // acabou. Melhor falhar alto e deixar o que já está no aparelho.
    const service = new SyncService(prismaFalso(null) as never);

    await expect(service.puxar('nao-existe', 'equipamentos')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('coleção desconhecida é 404', async () => {
    const service = new SyncService(prismaFalso('x') as never);
    await expect(service.puxar('emp', 'planetas')).rejects.toThrow(
      NotFoundException,
    );
  });
});
