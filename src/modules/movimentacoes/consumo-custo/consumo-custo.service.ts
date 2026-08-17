import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import {
  mapAbastecimentoRowToDoc,
} from '../../../common/prisma/abastecimento-api.mapper';
import { resolverCompanyId } from '../../../common/prisma/company-resolver';
import { fetchEquipmentMapPg } from '../../../common/prisma/equipment-resolver';
import { PrismaService } from '../../../prisma/prisma.service';
import { parseDateEnd, parseDateStart } from '../shared/date.helper';
import type {
  AbastecimentoConsumoInput,
  ConsumoCustoPayload,
} from './consumo-custo.types';
import {
  buildConsumoCustoPayload,
  buildVeiculoCard,
  formatPeriodoLabel,
} from './helpers/consumo-custo.helper';

const ABASTECIMENTO_INCLUDE = {
  equipment: {
    select: { legacyId: true, placa: true, chassi: true, descricao: true },
  },
} as const;

@Injectable()
export class ConsumoCustoService {
  constructor(private readonly prisma: PrismaService) {}

  async listarPorPrefeitura(
    prefeituraId: string,
    startDate?: string,
    endDate?: string,
  ): Promise<{ data: ConsumoCustoPayload; message: string }> {
    try {
      const companyId = await resolverCompanyId(this.prisma, prefeituraId);
      if (!companyId) {
        return {
          data: buildConsumoCustoPayload([], {
            label: formatPeriodoLabel(startDate, endDate),
            startDate: startDate ?? null,
            endDate: endDate ?? null,
          }),
          message: 'Consumo e custo buscados com sucesso!',
        };
      }

      const startIso = startDate
        ? parseDateStart(startDate, 'startDate').toISOString()
        : undefined;
      const endIso = endDate
        ? parseDateEnd(endDate, 'endDate').toISOString()
        : undefined;

      const periodo = {
        label: formatPeriodoLabel(startDate, endDate),
        startDate: startDate ?? null,
        endDate: endDate ?? null,
      };

      const where: {
        companyId: string;
        createdAt?: { gte?: Date; lte?: Date };
      } = { companyId };

      if (startDate) {
        where.createdAt = {
          ...where.createdAt,
          gte: parseDateStart(startDate, 'startDate'),
        };
      }
      if (endDate) {
        where.createdAt = {
          ...where.createdAt,
          lte: parseDateEnd(endDate, 'endDate'),
        };
      }

      const rows = await this.prisma.abastecimento.findMany({
        where,
        orderBy: { createdAt: 'asc' },
        include: ABASTECIMENTO_INCLUDE,
      });

      if (rows.length === 0) {
        return {
          data: buildConsumoCustoPayload([], periodo),
          message: 'Consumo e custo buscados com sucesso!',
        };
      }

      const grouped = new Map<string, AbastecimentoConsumoInput[]>();

      for (const row of rows) {
        const doc = mapAbastecimentoRowToDoc(row, prefeituraId);
        if (!doc.equipmentId) continue;
        const items = grouped.get(doc.equipmentId) ?? [];
        items.push({
          id: doc.id,
          equipmentId: doc.equipmentId,
          plateOrChassis: doc.plateOrChassis,
          liters: doc.liters,
          currentReading: doc.currentReading,
          measurementType:
            doc.measurementType === 'horimetro' ? 'horimetro' : 'hodometro',
          total: doc.total ?? null,
          pricePerLiter: doc.pricePerLiter ?? null,
          postoId: doc.postoId ?? null,
          createdAt: doc.createdAt,
        });
        grouped.set(doc.equipmentId, items);
      }

      const equipmentIds = [...grouped.keys()];
      const equipmentMap = await fetchEquipmentMapPg(
        this.prisma,
        equipmentIds,
      );

      const veiculos = [...grouped.entries()]
        .map(([equipmentId, abastecimentos]) =>
          buildVeiculoCard(
            equipmentId,
            abastecimentos,
            equipmentMap.get(equipmentId) ?? {},
            startIso,
            endIso,
          ),
        )
        .filter((item): item is NonNullable<typeof item> => item !== null)
        .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));

      return {
        data: buildConsumoCustoPayload(veiculos, periodo),
        message: 'Consumo e custo buscados com sucesso!',
      };
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      console.error('Erro ao buscar consumo e custo:', error);
      throw new InternalServerErrorException(
        'Não foi possível buscar consumo e custo por veículo.',
      );
    }
  }
}
