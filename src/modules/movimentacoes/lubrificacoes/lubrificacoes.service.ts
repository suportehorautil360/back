import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { FirebaseService } from '../../../config/firebase.service';
import { CreateLubrificacaoDto } from './dto/create-lubrificacao.dto';
import {
  isSupportedReadingUnit,
  parseReading,
  sanitizeGreasedPoints,
} from './helpers/lubrificacoes-create.helper';
import {
  fetchEquipmentMap,
  resolveEquipmentIdByPlateOrChassis,
} from '../shared/equipment.helper';
import { formatDateTime } from '../shared/date.helper';
import { fetchPrefeituraDocs } from '../shared/prefeitura-query.helper';
import { reverseGeocode } from '../shared/reverse-geocode.helper';
import { LubrificacaoDoc, LubrificacaoListItem } from './lubrificacoes.types';

@Injectable()
export class LubrificacoesService {
  constructor(private firebaseService: FirebaseService) {}

  private get collection() {
    return this.firebaseService.getFirestore().collection('lubrificacoes');
  }

  private get equipamentosCollection() {
    return this.firebaseService.getFirestore().collection('equipamentos');
  }

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

    const equipmentId = await resolveEquipmentIdByPlateOrChassis(
      this.equipamentosCollection,
      input.prefeituraId,
      input.plateOrChassis,
    );

    const id = randomUUID();
    const doc: LubrificacaoDoc = {
      id,
      prefeituraId: input.prefeituraId,
      equipmentId,
      plateOrChassis: input.plateOrChassis,
      comboistaNome: input.comboistaNome,
      tipo: 'lubrificacao',
      reading,
      readingUnit: input.readingUnit,
      greasedPoints,
      observation: input.observation,
      latitude: input.latitude,
      longitude: input.longitude,
      createdAt: new Date().toISOString(),
    };

    try {
      await this.collection.doc(id).set(doc);
      return doc;
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
      const docs = await fetchPrefeituraDocs<LubrificacaoDoc>(
        this.collection,
        prefeituraId,
        { startDate, endDate, order: 'desc' },
      );

      if (docs.length === 0) {
        return { data: [], message: 'Lubrificações buscadas com sucesso!' };
      }

      const uniqueEquipmentIds = [
        ...new Set(docs.map((doc) => doc.equipmentId).filter(Boolean)),
      ];
      const equipmentMap = await fetchEquipmentMap(
        this.equipamentosCollection,
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

function asString(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return '';
}
