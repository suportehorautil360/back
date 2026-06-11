import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import { FirebaseService } from '../../../config/firebase.service';
import { AbastecimentoDoc } from '../abastecimentos/abastecimentos.service';
import { fetchEquipmentMap } from '../shared/equipment.helper';
import { parseDateEnd, parseDateStart } from '../shared/date.helper';
import { fetchPrefeituraDocs } from '../shared/prefeitura-query.helper';
import type {
  AbastecimentoConsumoInput,
  ConsumoCustoPayload,
} from './consumo-custo.types';
import {
  buildConsumoCustoPayload,
  buildVeiculoCard,
  formatPeriodoLabel,
} from './helpers/consumo-custo.helper';

@Injectable()
export class ConsumoCustoService {
  constructor(private firebaseService: FirebaseService) {}

  private get abastecimentosCollection() {
    return this.firebaseService.getFirestore().collection('abastecimentos');
  }

  private get equipamentosCollection() {
    return this.firebaseService.getFirestore().collection('equipamentos');
  }

  async listarPorPrefeitura(
    prefeituraId: string,
    startDate?: string,
    endDate?: string,
  ): Promise<{ data: ConsumoCustoPayload; message: string }> {
    try {
      const startIso = startDate
        ? parseDateStart(startDate, 'startDate').toISOString()
        : undefined;
      const endIso = endDate
        ? parseDateEnd(endDate, 'endDate').toISOString()
        : undefined;

      const periodo = {
        label: formatPeriodoLabel(startIso, endIso),
        startDate: startDate ?? null,
        endDate: endDate ?? null,
      };

      const docs = await fetchPrefeituraDocs<AbastecimentoDoc>(
        this.abastecimentosCollection,
        prefeituraId,
        { order: 'asc' },
      );

      if (docs.length === 0) {
        return {
          data: buildConsumoCustoPayload([], periodo),
          message: 'Consumo e custo buscados com sucesso!',
        };
      }

      const grouped = new Map<string, AbastecimentoConsumoInput[]>();

      for (const doc of docs) {
        if (!doc.equipmentId) continue;
        const items = grouped.get(doc.equipmentId) ?? [];
        items.push({
          id: doc.id,
          equipmentId: doc.equipmentId,
          plateOrChassis: doc.plateOrChassis,
          liters: doc.liters,
          currentReading: doc.currentReading,
          measurementType: doc.measurementType,
          total: doc.total ?? null,
          pricePerLiter: doc.pricePerLiter ?? null,
          postoId: doc.postoId ?? null,
          createdAt: doc.createdAt,
        });
        grouped.set(doc.equipmentId, items);
      }

      const equipmentIds = [...grouped.keys()];
      const equipmentMap = await this.fetchEquipmentMapBatched(equipmentIds);

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

  private async fetchEquipmentMapBatched(ids: string[]) {
    const map = new Map<string, Record<string, unknown>>();
    for (let index = 0; index < ids.length; index += 30) {
      const batch = ids.slice(index, index + 30);
      const partial = await fetchEquipmentMap(
        this.equipamentosCollection,
        batch,
      );
      partial.forEach((value, key) => map.set(key, value));
    }
    return map;
  }
}
