import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import { FirebaseService } from '../../../config/firebase.service';
import { AbastecimentoDoc } from '../abastecimentos/abastecimentos.service';
import {
  resolveCurrentReading,
  resolveLiters,
} from '../abastecimentos/abastecimentos.mapper';
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
        label: formatPeriodoLabel(startDate, endDate),
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
        const raw = doc as unknown as Record<string, unknown>;
        const items = grouped.get(doc.equipmentId) ?? [];
        items.push({
          id: doc.id,
          equipmentId: doc.equipmentId,
          plateOrChassis: doc.plateOrChassis,
          liters: resolveLiters(raw),
          currentReading: resolveCurrentReading(raw),
          measurementType:
            doc.measurementType === 'horimetro' ? 'horimetro' : 'hodometro',
          total: resolveTotalAbastecimento(raw),
          pricePerLiter: resolvePricePerLiter(raw),
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

function resolvePricePerLiter(raw: Record<string, unknown>): number | null {
  const n = Number(raw.pricePerLiter);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Total em R$ — direto ou calculado a partir de preço/l × litros. */
function resolveTotalAbastecimento(raw: Record<string, unknown>): number | null {
  const total = Number(raw.total);
  if (Number.isFinite(total) && total > 0) {
    return Math.round(total * 100) / 100;
  }
  const ppl = resolvePricePerLiter(raw);
  const liters = resolveLiters(raw);
  if (ppl !== null && liters > 0) {
    return Math.round(ppl * liters * 100) / 100;
  }
  return null;
}
