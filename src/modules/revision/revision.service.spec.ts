jest.mock('node:crypto', () => ({
  randomUUID: jest.fn().mockReturnValue('fixed-uuid'),
}));

jest.mock('../../prisma/prisma.service', () => ({
  PrismaService: class PrismaService {},
}));

jest.mock('../../common/prisma/equipment-resolver', () => ({
  resolveEquipmentByIdPg: jest.fn(),
}));

jest.mock('../../common/prisma/company-resolver', () => ({
  resolverCompanyId: jest.fn(),
  companyWhere: jest.fn((id: string) => ({ legacyId: id })),
}));

import { BadRequestException, NotFoundException } from '@nestjs/common';
import { RevisionService } from './revision.service';
import { resolveEquipmentByIdPg } from '../../common/prisma/equipment-resolver';
import { resolverCompanyId } from '../../common/prisma/company-resolver';
import { CreateRevisionDto } from './dto/create-revision.dto';

const resolveEquip = jest.mocked(resolveEquipmentByIdPg);
const resolveCompany = jest.mocked(resolverCompanyId);

type EquipmentRow = {
  id: string;
  tipo?: string | null;
  medicaoAtual?: number | null;
  ultimaRevisao?: number | null;
  intervaloRevisao?: number | null;
  unidadeRevisao?: string | null;
};

function makePrisma(equipmentRow: EquipmentRow | null) {
  const revisionCreate = jest.fn().mockResolvedValue({});
  const equipmentUpdate = jest.fn().mockResolvedValue({});

  const prisma = {
    equipment: {
      findUnique: jest.fn().mockResolvedValue(equipmentRow),
      update: equipmentUpdate,
    },
    companySettings: {
      findUnique: jest.fn().mockResolvedValue(null),
    },
    equipmentRevision: {
      create: revisionCreate,
    },
    $transaction: jest.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
  };

  return {
    prisma: prisma as ConstructorParameters<typeof RevisionService>[0],
    revisionCreate,
    equipmentUpdate,
  };
}

function stubEquipment(
  row: EquipmentRow,
  publicId = 'veh-1',
) {
  resolveEquip.mockResolvedValue({
    id: publicId,
    equipmentUuid: row.id,
    capacidadeTanque: 0,
    raw: {},
  });
}

const dto: CreateRevisionDto = {
  revisionDate: new Date('2026-05-25T00:00:00.000Z'),
  odometerReading: 15000,
  mechanicOrOfficeName: 'Oficina X',
  servicesDescription: 'Troca de óleo',
  revisionCost: 200,
  invoiceNumber: 'NF-1',
  prefeituraId: 'pref-1',
  vehicleId: 'veh-1',
};

beforeAll(() => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterAll(() => {
  jest.restoreAllMocks();
});
beforeEach(() => {
  jest.clearAllMocks();
  resolveCompany.mockResolvedValue('company-uuid');
});

describe('RevisionService.complete', () => {
  it('grava revisão concluída e libera o veículo (recalcula leitura/última revisão)', async () => {
    const row = {
      id: 'eq-uuid',
      medicaoAtual: 12000,
      unidadeRevisao: 'km',
    };
    const { prisma, revisionCreate, equipmentUpdate } = makePrisma(row);
    stubEquipment(row);
    const service = new RevisionService(prisma);

    const res = await service.complete(dto);

    expect(revisionCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'Concluída',
          leitura: 15000,
        }),
      }),
    );
    expect(equipmentUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'eq-uuid' },
        data: expect.objectContaining({
          medicaoAtual: 15000,
          ultimaRevisao: 15000,
          status: 'ativo',
        }),
      }),
    );
    expect(res.message).toMatch(/liberado/i);
  });

  it('lança 404 quando o veículo não existe', async () => {
    resolveEquip.mockRejectedValue(
      new NotFoundException('Equipamento não encontrado'),
    );
    const { prisma, revisionCreate } = makePrisma(null);
    const service = new RevisionService(prisma);

    await expect(service.complete(dto)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(revisionCreate).not.toHaveBeenCalled();
  });

  it('recusa leitura menor que a atual do veículo', async () => {
    const row = {
      id: 'eq-uuid',
      medicaoAtual: 20000,
      unidadeRevisao: 'km',
    };
    const { prisma, equipmentUpdate } = makePrisma(row);
    stubEquipment(row);
    const service = new RevisionService(prisma);

    await expect(service.complete(dto)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(equipmentUpdate).not.toHaveBeenCalled();
  });
});

describe('RevisionService.create', () => {
  it('compara contra medicaoAtual (não odometerReading do payload)', async () => {
    const row = {
      id: 'eq-uuid',
      medicaoAtual: 50000,
      ultimaRevisao: 0,
      unidadeRevisao: 'km',
    };
    const { prisma } = makePrisma(row);
    stubEquipment(row);
    const service = new RevisionService(prisma);

    await expect(service.create(dto)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('exige leitura ao menos 1.000 maior que a última revisão', async () => {
    const row = {
      id: 'eq-uuid',
      medicaoAtual: 0,
      ultimaRevisao: 14500,
      unidadeRevisao: 'km',
    };
    const { prisma } = makePrisma(row);
    stubEquipment(row);
    const service = new RevisionService(prisma);

    await expect(service.create(dto)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('usa intervalo por tipo vindo das configurações da prefeitura', async () => {
    const row = {
      id: 'eq-uuid',
      medicaoAtual: 0,
      ultimaRevisao: 14500,
      tipo: 'caminhão',
      unidadeRevisao: 'km',
    };
    const { prisma } = makePrisma(row);
    stubEquipment(row);
    (prisma.companySettings.findUnique as jest.Mock).mockResolvedValue({
      intervalos: { caminhao: { valor: 2000, unidade: 'km' } },
    });
    const service = new RevisionService(prisma);

    await expect(service.create(dto)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('aceita alias de tipo (truck) e usa unidade das configurações', async () => {
    const row = {
      id: 'eq-uuid',
      medicaoAtual: 0,
      ultimaRevisao: 14500,
      tipo: 'truck',
      unidadeRevisao: 'km',
    };
    const { prisma } = makePrisma(row);
    stubEquipment(row);
    (prisma.companySettings.findUnique as jest.Mock).mockResolvedValue({
      intervalos: { caminhao: { valor: 2000, unidade: 'horas' } },
    });
    const service = new RevisionService(prisma);

    try {
      await service.create(dto);
      fail('Era esperado BadRequestException para revisão abaixo do intervalo');
    } catch (error) {
      expect(error).toBeInstanceOf(BadRequestException);
      expect((error as BadRequestException).message).toContain('2000 horas');
    }
  });
});
