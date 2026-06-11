import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { FirebaseService } from '../../../config/firebase.service';
import { fetchEquipmentMap } from '../shared/equipment.helper';
import { fetchPrefeituraDocs } from '../shared/prefeitura-query.helper';
import type {
  HistoricoGroup,
  HistoricoItem,
  HistoricoResponse,
  HistoricoSummary,
} from './historico.types';

type RawDoc = Record<string, unknown>;

@Injectable()
export class HistoricoService {
  constructor(private readonly firebaseService: FirebaseService) {}

  private db() {
    return this.firebaseService.getFirestore();
  }

  async listarPorPrefeitura(
    prefeituraId: string,
    limit = 50,
  ): Promise<HistoricoResponse> {
    try {
      const [abDocs, lubDocs, reaDocs] = await Promise.all([
        fetchPrefeituraDocs<RawDoc & { createdAt: string }>(
          this.db().collection('abastecimentos'),
          prefeituraId,
          { order: 'desc', limit },
        ),
        fetchPrefeituraDocs<RawDoc & { createdAt: string }>(
          this.db().collection('lubrificacoes'),
          prefeituraId,
          { order: 'desc', limit },
        ),
        fetchPrefeituraDocs<RawDoc & { createdAt: string }>(
          this.db().collection('reabastecimentos'),
          prefeituraId,
          { order: 'desc', limit },
        ),
      ]);

      const allEquipmentIds = [
        ...new Set(
          [...abDocs, ...lubDocs]
            .map((d) => d.equipmentId as string | undefined)
            .filter((id): id is string => Boolean(id)),
        ),
      ];

      const equipmentMap = await fetchEquipmentMap(
        this.db().collection('equipamentos'),
        allEquipmentIds,
      );

      const abItems = abDocs.map((d) =>
        this.formatAbastecimento(d, equipmentMap),
      );
      const lubItems = lubDocs.map((d) =>
        this.formatLubrificacao(d, equipmentMap),
      );
      const reaItems = reaDocs.map((d) => this.formatReabastecimento(d));

      const all = [...abItems, ...lubItems, ...reaItems]
        .sort(
          (a, b) =>
            new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
        )
        .slice(0, limit);

      const summary = this.buildSummary(abDocs, lubDocs);
      const groups = this.groupByDate(all);

      return { summary, groups, message: 'Histórico carregado com sucesso!' };
    } catch (error) {
      console.error('Erro ao buscar histórico:', error);
      throw new InternalServerErrorException(
        'Não foi possível carregar o histórico.',
      );
    }
  }

  private buildSummary(abDocs: RawDoc[], lubDocs: RawDoc[]): HistoricoSummary {
    const todayPrefix = new Date().toISOString().slice(0, 10);

    const totalLitersToday = abDocs
      .filter((d) => (d.createdAt as string).startsWith(todayPrefix))
      .reduce(
        (sum, d) => sum + (typeof d.liters === 'number' ? d.liters : 0),
        0,
      );

    const totalAbastecimentosToday = abDocs.filter((d) =>
      (d.createdAt as string).startsWith(todayPrefix),
    ).length;

    const totalEngraxeToday = lubDocs.filter((d) =>
      (d.createdAt as string).startsWith(todayPrefix),
    ).length;

    return { totalLitersToday, totalAbastecimentosToday, totalEngraxeToday };
  }

  private groupByDate(items: HistoricoItem[]): HistoricoGroup[] {
    const map = new Map<string, HistoricoItem[]>();

    for (const item of items) {
      const label = buildDateLabel(item.createdAt);
      const existing = map.get(label);
      if (existing) {
        existing.push(item);
      } else {
        map.set(label, [item]);
      }
    }

    return Array.from(map.entries()).map(([dateLabel, groupItems]) => ({
      dateLabel,
      items: groupItems,
    }));
  }

  private formatAbastecimento(
    doc: RawDoc,
    equipmentMap: Map<string, RawDoc>,
  ): HistoricoItem {
    const equipment = equipmentMap.get(doc.equipmentId as string) ?? {};
    const plate = asString(
      equipment.placa ?? equipment.chassis ?? doc.plateOrChassis,
    );
    const equipType = asString(
      equipment.descricao ?? equipment.label ?? doc.plateOrChassis,
    );
    const reading =
      typeof doc.currentReading === 'number'
        ? `${doc.currentReading.toLocaleString('pt-BR')} ${doc.measurementType === 'horimetro' ? 'h' : 'km'}`
        : null;
    const liters = typeof doc.liters === 'number' ? doc.liters : 0;

    return {
      id: doc.id as string,
      tipo: 'abastecimento',
      plate,
      equipmentLabel: reading ? `${equipType} · ${reading}` : equipType,
      rightLabel: `${liters} L`,
      time: extractTime(doc.createdAt as string),
      createdAt: doc.createdAt as string,
    };
  }

  private formatLubrificacao(
    doc: RawDoc,
    equipmentMap: Map<string, RawDoc>,
  ): HistoricoItem {
    const equipment = equipmentMap.get(doc.equipmentId as string) ?? {};
    const plate = asString(
      equipment.placa ?? equipment.chassis ?? doc.plateOrChassis,
    );
    const equipType = asString(
      equipment.descricao ?? equipment.label ?? doc.plateOrChassis,
    );
    const pointCount = Array.isArray(doc.greasedPoints)
      ? doc.greasedPoints.length
      : 0;

    return {
      id: doc.id as string,
      tipo: 'lubrificacao',
      plate,
      equipmentLabel: `${equipType} · ${pointCount} ponto${pointCount !== 1 ? 's' : ''}`,
      rightLabel: 'engraxe',
      time: extractTime(doc.createdAt as string),
      createdAt: doc.createdAt as string,
    };
  }

  private formatReabastecimento(doc: RawDoc): HistoricoItem {
    const liters =
      typeof doc.receivedLiters === 'number' ? doc.receivedLiters : 0;
    const source = sourceLabel(doc.sourceType as string | undefined);

    return {
      id: doc.id as string,
      tipo: 'reabastecimento',
      plate: source,
      equipmentLabel: 'Reabastecimento do comboio',
      rightLabel: `${liters} L`,
      time: extractTime(doc.createdAt as string),
      createdAt: doc.createdAt as string,
    };
  }
}

function extractTime(isoString: string): string {
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return '';
  const h = String(date.getHours()).padStart(2, '0');
  const m = String(date.getMinutes()).padStart(2, '0');
  return `${h}:${m}`;
}

function buildDateLabel(isoString: string): string {
  const date = new Date(isoString);
  const now = new Date();

  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();

  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);

  const day = String(date.getDate()).padStart(2, '0');
  const month = date
    .toLocaleDateString('pt-BR', { month: 'short' })
    .replace('.', '')
    .toUpperCase();

  if (sameDay(date, now)) return `HOJE · ${day} ${month}`;
  if (sameDay(date, yesterday)) return `ONTEM · ${day} ${month}`;
  return `${day} ${month}`;
}

function sourceLabel(sourceType: string | undefined): string {
  const map: Record<string, string> = {
    gasStation: 'Posto',
    farmTank: 'Tanque fazenda',
    distributor: 'Distribuidora',
  };
  return sourceType ? (map[sourceType] ?? sourceType) : '—';
}

function asString(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean')
    return String(value);
  return '';
}
