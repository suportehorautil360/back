import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { resolverCompanyId } from '../../../common/prisma/company-resolver';
import {
  fetchEquipmentMapPg,
  resolveEquipmentByPlateOrChassisPg,
} from '../../../common/prisma/equipment-resolver';
import { PrismaService } from '../../../prisma/prisma.service';
import { CreateLubrificacaoDto } from './dto/create-lubrificacao.dto';
import {
  isSupportedReadingUnit,
  parseReading,
  sanitizeGreasedPoints,
} from './helpers/lubrificacoes-create.helper';
import { formatDateTime, parseDateEnd, parseDateStart } from '../shared/date.helper';
import { reverseGeocode } from '../shared/reverse-geocode.helper';
import { LubrificacaoDoc, LubrificacaoListItem } from './lubrificacoes.types';

const LUBRIFICACAO_INCLUDE = {
  equipment: { select: { legacyId: true, id: true } },
} as const;

@Injectable()
export class LubrificacoesService {
  constructor(private readonly prisma: PrismaService) {}

  async create(input: CreateLubrificacaoDto): Promise<LubrificacaoDoc> {
    const reading = parseReading(input.reading);
    if (reading === null) {
      throw new BadRequestException(
        'O campo reading deve ser maior ou igual a zero.',
      );
    }

    if (!isSupportedReadingUnit(input.readingUnit)) {
      throw new BadRequestException('O campo readingUnit deve ser h ou km.');
    }

    const greasedPoints = sanitizeGreasedPoints(input.greasedPoints);
    if (greasedPoints.length === 0) {
      throw new BadRequestException(
        'O campo greasedPoints deve conter ao menos um item válido.',
      );
    }

    const companyId = await this.requireCompanyId(input.prefeituraId);
    const equipamento = await resolveEquipmentByPlateOrChassisPg(
      this.prisma,
      input.prefeituraId,
      input.plateOrChassis,
    );

    const id = randomUUID();
    const createdAt = new Date();

    try {
      await this.prisma.lubrificacao.create({
        data: {
          legacyId: id,
          companyId,
          equipmentId: equipamento.equipmentUuid,
          plateOrChassis: input.plateOrChassis,
          comboistaNome: input.comboistaNome,
          reading,
          readingUnit: input.readingUnit,
          greasedPoints: greasedPoints as unknown as string[],
          observation: input.observation?.trim() || null,
          latitude: input.latitude,
          longitude: input.longitude,
          createdAt,
        },
      });

      return {
        id,
        prefeituraId: input.prefeituraId,
        equipmentId: equipamento.id,
        plateOrChassis: input.plateOrChassis,
        comboistaNome: input.comboistaNome,
        tipo: 'lubrificacao',
        reading,
        readingUnit: input.readingUnit,
        greasedPoints,
        observation: input.observation,
        latitude: input.latitude,
        longitude: input.longitude,
        createdAt: createdAt.toISOString(),
      };
    } catch (error) {
      console.error('Erro ao criar lubrificacao:', error);
      throw new InternalServerErrorException(
        'Não foi possível registrar a lubrificação.',
      );
    }
  }

  async listarPorPrefeitura(
    prefeituraId: string,
    startDate?: string,
    endDate?: string,
  ): Promise<{ data: LubrificacaoListItem[]; message: string }> {
    try {
      const companyId = await resolverCompanyId(this.prisma, prefeituraId);
      if (!companyId) {
        return { data: [], message: 'Lubrificações buscadas com sucesso!' };
      }

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

      const rows = await this.prisma.lubrificacao.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        include: LUBRIFICACAO_INCLUDE,
      });

      if (rows.length === 0) {
        return { data: [], message: 'Lubrificações buscadas com sucesso!' };
      }

      const docs: LubrificacaoDoc[] = rows.map((row) =>
        mapRowToDoc(row, prefeituraId),
      );

      const uniqueEquipmentIds = [
        ...new Set(docs.map((doc) => doc.equipmentId).filter(Boolean)),
      ];
      const equipmentMap = await fetchEquipmentMapPg(
        this.prisma,
        uniqueEquipmentIds,
      );

      const data: LubrificacaoListItem[] = [];
      for (const doc of docs) {
        data.push(await this.formatListItem(doc, equipmentMap));
      }

      return { data, message: 'Lubrificações buscadas com sucesso!' };
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      console.error('Erro ao buscar lubrificações:', error);
      throw new InternalServerErrorException(
        'Não foi possível buscar as lubrificações.',
      );
    }
  }

  private async requireCompanyId(prefeituraId: string): Promise<string> {
    const companyId = await resolverCompanyId(this.prisma, prefeituraId);
    if (!companyId) {
      throw new BadRequestException('Empresa não encontrada.');
    }
    return companyId;
  }

  private async formatListItem(
    doc: LubrificacaoDoc,
    equipmentMap: Map<string, Record<string, unknown>>,
  ): Promise<LubrificacaoListItem> {
    const equipment = equipmentMap.get(doc.equipmentId) ?? {};
    const local =
      doc.latitude && doc.longitude
        ? await reverseGeocode(doc.latitude, doc.longitude)
        : null;

    const listItem: LubrificacaoListItem = {
      id: doc.id,
      dateTime: formatDateTime(doc.createdAt),
      vehicle: {
        name: asString(
          equipment.descricao ?? equipment.label ?? doc.plateOrChassis,
        ),
        plate: asString(
          equipment.placa ?? equipment.chassis ?? doc.plateOrChassis,
        ),
        type: asString(equipment.tipo ?? equipment.linha ?? '—'),
      },
      comboistaNome: asString(doc.comboistaNome),
      reading: `${doc.reading.toLocaleString('pt-BR')} ${doc.readingUnit}`,
      greasedPoints: doc.greasedPoints,
      observation: doc.observation ?? null,
      local,
      createdAt: doc.createdAt,
    };

    return listItem;
  }
}

function mapRowToDoc(
  row: {
    id: string;
    legacyId: string | null;
    plateOrChassis: string | null;
    comboistaNome: string | null;
    reading: number | null;
    readingUnit: string | null;
    greasedPoints: unknown;
    observation: string | null;
    latitude: number | null;
    longitude: number | null;
    createdAt: Date;
    equipment: { legacyId: string | null; id: string } | null;
  },
  prefeituraId: string,
): LubrificacaoDoc {
  const greasedRaw = Array.isArray(row.greasedPoints) ? row.greasedPoints : [];
  const greasedPoints = greasedRaw.filter(
    (v): v is LubrificacaoDoc['greasedPoints'][number] =>
      typeof v === 'string',
  );

  return {
    id: row.legacyId ?? row.id,
    prefeituraId,
    equipmentId: row.equipment?.legacyId ?? row.equipment?.id ?? '',
    plateOrChassis: row.plateOrChassis ?? '',
    comboistaNome: row.comboistaNome ?? '',
    tipo: 'lubrificacao',
    reading: row.reading ?? 0,
    readingUnit: (row.readingUnit === 'km' ? 'km' : 'h') as 'h' | 'km',
    greasedPoints,
    observation: row.observation ?? undefined,
    latitude: row.latitude ?? 0,
    longitude: row.longitude ?? 0,
    createdAt: row.createdAt.toISOString(),
  };
}

function asString(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return '';
}
