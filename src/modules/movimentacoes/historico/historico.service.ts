import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { mapAbastecimentoRowToDoc } from '../../../common/prisma/abastecimento-api.mapper';
import { resolverCompanyId } from '../../../common/prisma/company-resolver';
import { fetchEquipmentMapPg } from '../../../common/prisma/equipment-resolver';
import { PrismaService } from '../../../prisma/prisma.service';
import type {
  HistoricoGroup,
  HistoricoItem,
  HistoricoResponse,
  HistoricoSummary,
} from './historico.types';

type RawDoc = Record<string, unknown>;

const ABASTECIMENTO_INCLUDE = {
  equipment: {
    select: { legacyId: true, placa: true, chassi: true, descricao: true },
  },
} as const;

@Injectable()
export class HistoricoService {
  constructor(private readonly prisma: PrismaService) {}

  async listarPorPrefeitura(
    prefeituraId: string,
    limit = 50,
  ): Promise<HistoricoResponse> {
    try {
      const companyId = await resolverCompanyId(this.prisma, prefeituraId);
      if (!companyId) {
        return {
          summary: {
            totalLitersToday: 0,
            totalAbastecimentosToday: 0,
            totalEngraxeToday: 0,
          },
          groups: [],
          message: 'Histórico carregado com sucesso!',
        };
      }

      const [abRows, lubRows, reaRows] = await Promise.all([
        this.prisma.abastecimento.findMany({
          where: { companyId },
          orderBy: { createdAt: 'desc' },
          take: limit,
          include: ABASTECIMENTO_INCLUDE,
        }),
        this.prisma.lubrificacao.findMany({
          where: { companyId },
          orderBy: { createdAt: 'desc' },
          take: limit,
          include: {
            equipment: { select: { legacyId: true, id: true } },
          },
        }),
        this.prisma.comboioReabastecimento.findMany({
          where: { companyId },
          orderBy: { createdAt: 'desc' },
          take: limit,
        }),
      ]);

      const abDocs = abRows
        .map((row) => mapAbastecimentoRowToDoc(row, prefeituraId))
        .filter((d) => d.createdAt !== '');

      const lubDocs: (RawDoc & { createdAt: string })[] = lubRows
        .map((row) => ({
          id: row.legacyId ?? row.id,
          equipmentId:
            row.equipment?.legacyId ?? row.equipmentId ?? row.equipment?.id ?? '',
          plateOrChassis: row.plateOrChassis ?? '',
          greasedPoints: Array.isArray(row.greasedPoints)
            ? row.greasedPoints
            : [],
          createdAt: row.createdAt.toISOString(),
        }))
        .filter((d) => d.createdAt !== '');

      const reaDocs: (RawDoc & { createdAt: string })[] = reaRows
        .map((row) => ({
          id: row.legacyId ?? row.id,
          receivedLiters: Number(row.receivedLiters),
          sourceType: row.sourceType,
          createdAt: row.createdAt.toISOString(),
        }))
        .filter((d) => d.createdAt !== '');

      const allEquipmentIds = [
        ...new Set(
          [...abDocs, ...lubDocs]
            .map((d) => d.equipmentId as string | undefined)
            .filter((id): id is string => Boolean(id)),
        ),
      ];

      const equipmentMap = await fetchEquipmentMapPg(
        this.prisma,
        allEquipmentIds,
      );

      const abItems = abDocs.map((d) =>
        this.formatAbastecimento(d as unknown as RawDoc, equipmentMap),
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

      const summary = this.buildSummary(
        abDocs as unknown as RawDoc[],
        lubDocs,
      );
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

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function sourceLabel(sourceType: string | undefined): string {
  switch (sourceType) {
    case 'gasStation':
      return 'Posto';
    case 'farmTank':
      return 'Tanque fazenda';
    case 'distributor':
      return 'Distribuidora';
    default:
      return 'Origem';
  }
}
