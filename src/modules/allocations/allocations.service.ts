import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { resolverCompanyId } from '../../common/prisma/company-resolver';
import { resolveEquipmentByIdPg } from '../../common/prisma/equipment-resolver';
import {
  mapAllocationToApi,
  parseAllocationStartDate,
} from '../../common/prisma/work-front-prisma.mapper';
import {
  allocationWhere,
  resolveWorkFrontPg,
} from '../../common/prisma/work-front-resolver';
import { CreateAllocationDto } from './dto/create-allocation.dto';

@Injectable()
export class AllocationsService {
  constructor(private readonly prisma: PrismaService) {}

  private async setObraDoEquipamento(equipmentUuid: string, obra: string) {
    if (!equipmentUuid) return;
    await this.prisma.equipment.update({
      where: { id: equipmentUuid },
      data: { obra },
    });
  }

  async allocate(createDto: CreateAllocationDto) {
    const companyId = await resolverCompanyId(
      this.prisma,
      createDto.prefeituraId,
    );
    if (!companyId) {
      throw new BadRequestException('Prefeitura não encontrada.');
    }

    const workFront = await resolveWorkFrontPg(
      this.prisma,
      createDto.workFrontId,
    );
    if (!workFront || workFront.companyId !== companyId) {
      throw new NotFoundException('Frente de trabalho não encontrada.');
    }

    const equip = await resolveEquipmentByIdPg(
      this.prisma,
      createDto.prefeituraId,
      createDto.vehicleId,
    );

    const legacyId = randomUUID();
    const startDate = parseAllocationStartDate(createDto.startDate);
    const now = new Date();

    await this.prisma.$transaction(async (tx) => {
      await tx.workFrontAllocation.updateMany({
        where: {
          equipmentId: equip.equipmentUuid,
          endDate: null,
        },
        data: { endDate: now },
      });

      await tx.workFrontAllocation.create({
        data: {
          legacyId,
          workFrontId: workFront.id,
          equipmentId: equip.equipmentUuid,
          funcao: createDto.function,
          startDate,
        },
      });
    });

    await this.setObraDoEquipamento(
      equip.equipmentUuid,
      createDto.workFrontName,
    );

    const row = await this.prisma.workFrontAllocation.findFirst({
      where: { legacyId },
      include: {
        workFront: { select: { id: true, legacyId: true, nome: true } },
        equipment: { select: { id: true, legacyId: true, placa: true } },
      },
    });

    if (!row) {
      throw new BadRequestException('Falha ao registrar alocação.');
    }

    return mapAllocationToApi(row, createDto.prefeituraId, createDto.workFrontName);
  }

  async remove(allocationId: string) {
    const row = await this.prisma.workFrontAllocation.findFirst({
      where: allocationWhere(allocationId),
      include: {
        equipment: { select: { id: true } },
      },
    });

    if (!row) return;

    const equipmentUuid = row.equipment?.id;

    await this.prisma.workFrontAllocation.delete({
      where: { id: row.id },
    });

    if (equipmentUuid) {
      await this.setObraDoEquipamento(equipmentUuid, '');
    }
  }
}
