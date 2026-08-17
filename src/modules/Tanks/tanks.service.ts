import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { ehComboioTipo, mapEquipmentToApi } from '../../common/prisma/equipment-api.mapper';
import { companyWhere } from '../../common/prisma/company-resolver';
import { tankStatusPg } from '../../common/prisma/tank-saldo-prisma.helper';
import { PrismaService } from '../../prisma/prisma.service';

function numero(valor: unknown): number {
  if (typeof valor === 'number') return Number.isFinite(valor) ? valor : 0;
  if (typeof valor === 'string') {
    const n = Number(valor);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

@Injectable()
export class TanksService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(prefeituraId: string) {
    try {
      const rows = await this.prisma.equipment.findMany({
        where: {
          company: companyWhere(prefeituraId),
          tipo: { equals: 'Comboio', mode: 'insensitive' },
        },
      });

      const data = rows.map((row) => {
        const api = mapEquipmentToApi(row, prefeituraId);
        const capacity = numero(row.capacidadeTanque);
        const currentVolume = numero(row.volumeTanqueAtual);
        const { percentage, status } = tankStatusPg(capacity, currentVolume);
        const publicId = row.legacyId ?? row.id;

        return {
          id: publicId,
          comboioId: publicId,
          prefeituraId,
          capacity,
          currentVolume,
          percentage,
          status,
          fuelType: api.combustivel ?? '',
          name: api.descricao || api.modelo || 'Comboio',
          veiculoModelo: api.modelo || api.descricao || '',
          veiculoPlaca: api.placa || '',
          veiculoChassis: api.chassis || api.chassi || '',
        };
      });

      return { data, message: 'Tanks encontrados com sucesso.' };
    } catch (error) {
      console.error('Error fetching tanks:', error);
      throw new InternalServerErrorException(
        'Não foi possível buscar os tanques.',
      );
    }
  }

  async findByComboio(comboioId: string) {
    try {
      const row = await this.prisma.equipment.findFirst({
        where: {
          OR: [{ id: comboioId }, { legacyId: comboioId }],
        },
        include: { company: { select: { legacyId: true } } },
      });

      if (!row || !ehComboioTipo(row.tipo)) {
        return { data: null, message: 'Tanque do comboio não encontrado.' };
      }

      const prefeituraId = row.company.legacyId ?? row.companyId;
      const api = mapEquipmentToApi(row, prefeituraId);
      const capacity = numero(row.capacidadeTanque);
      const currentVolume = numero(row.volumeTanqueAtual);
      const { percentage, status } = tankStatusPg(capacity, currentVolume);
      const publicId = row.legacyId ?? row.id;

      return {
        data: {
          id: publicId,
          comboioId: publicId,
          prefeituraId,
          capacity,
          currentVolume,
          percentage,
          status,
          fuelType: api.combustivel ?? '',
          veiculoModelo: api.modelo || api.descricao || '',
          veiculoPlaca: api.placa || '',
        },
        message: 'Tanque do comboio encontrado com sucesso.',
      };
    } catch (error) {
      console.error('Error fetching tank by comboio:', error);
      throw new InternalServerErrorException(
        'Não foi possível buscar o tanque do comboio.',
      );
    }
  }
}
