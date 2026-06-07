import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { FirebaseService } from '../../../config/firebase.service';
import {
  CreateAbastecimentoDto,
  TipoMedicao,
} from './dto/create-abastecimento.dto';
import {
  isSupportedMeasurementType,
  parseLiters,
  resolveAbastecimentoPricing,
} from './helpers/abastecimentos-create.helper';
import {
  fetchEquipmentMap,
  resolveEquipmentIdByPlateOrChassis,
} from '../shared/equipment.helper';
import {
  formatDateTime,
  parseDateEnd,
  parseDateStart,
} from '../shared/date.helper';
import { reverseGeocode } from '../shared/reverse-geocode.helper';

export interface AbastecimentoDoc {
  id: string;
  prefeituraId: string;
  equipmentId: string;
  plateOrChassis: string;
  liters: number;
  tipo: 'comboio';
  measurementType: TipoMedicao;
  currentReading: number;
  meterPhoto?: string;
  pricePerLiter?: number | null;
  total?: number | null;
  postoId?: string;
  latitude: number;
  longitude: number;
  createdAt: string;
}

@Injectable()
export class AbastecimentosService {
  constructor(private firebaseService: FirebaseService) {}

  private get collection() {
    return this.firebaseService.getFirestore().collection('abastecimentos');
  }

  private get equipamentosCollection() {
    return this.firebaseService.getFirestore().collection('equipamentos');
  }

  async create(input: CreateAbastecimentoDto): Promise<AbastecimentoDoc> {
    const liters = parseLiters(input.liters);
    if (liters === null) {
      throw new BadRequestException('O campo liters deve ser maior que zero.');
    }

    if (!isSupportedMeasurementType(input.measurementType)) {
      throw new BadRequestException(
        'O campo measurementType deve ser horimetro ou hodometro.',
      );
    }

    const equipmentId = await resolveEquipmentIdByPlateOrChassis(
      this.equipamentosCollection,
      input.prefeituraId,
      input.plateOrChassis,
    );

    const pricing = resolveAbastecimentoPricing(
      liters,
      input.pricePerLiter,
      input.total,
    );

    const id = randomUUID();
    const doc: AbastecimentoDoc = {
      id,
      prefeituraId: input.prefeituraId,
      equipmentId,
      plateOrChassis: input.plateOrChassis,
      liters,
      tipo: 'comboio',
      measurementType: input.measurementType,
      currentReading: Number(input.currentReading),
      meterPhoto: input.meterPhoto,
      pricePerLiter: pricing.pricePerLiter,
      total: pricing.total,
      postoId: input.postoId?.trim() || undefined,
      latitude: input.latitude,
      longitude: input.longitude,
      createdAt: new Date().toISOString(),
    };

    try {
      await this.collection.doc(id).set(doc);
      return doc;
    } catch (error) {
      console.error('Erro ao criar abastecimento:', error);
      throw new InternalServerErrorException(
        'Não foi possível registrar o abastecimento.',
      );
    }
  }

  /** Lista os abastecimentos da prefeitura formatados para a tela. */
  async listar(prefeituraId: string, startDate?: string, endDate?: string) {
    try {
      let query = this.collection
        .where('prefeituraId', '==', prefeituraId)
        .orderBy('createdAt', 'desc');

      if (startDate) {
        const start = parseDateStart(startDate, 'startDate');
        query = query.where('createdAt', '>=', start.toISOString());
      }

      if (endDate) {
        const end = parseDateEnd(endDate, 'endDate');
        query = query.where('createdAt', '<=', end.toISOString());
      }

      const snap = await query.get();

      if (snap.empty) {
        return { data: [], message: 'Abastecimentos buscados com sucesso!' };
      }

      const docs = snap.docs.map((d) => d.data() as AbastecimentoDoc);

      const uniqueEquipmentIds = [
        ...new Set(docs.map((d) => d.equipmentId).filter(Boolean)),
      ];
      const equipmentMap = await fetchEquipmentMap(
        this.equipamentosCollection,
        uniqueEquipmentIds,
      );

      const data = await Promise.all(
        docs.map((doc) => this.formatAbastecimento(doc, equipmentMap)),
      );

      return { data, message: 'Abastecimentos buscados com sucesso!' };
    } catch (error) {
      console.error('Erro ao buscar abastecimentos:', error);
      throw new InternalServerErrorException(
        'Não foi possível buscar os abastecimentos.',
      );
    }
  }

  private async formatAbastecimento(
    doc: AbastecimentoDoc,
    equipmentMap: Map<string, Record<string, unknown>>,
  ) {
    const equipment = equipmentMap.get(doc.equipmentId) ?? {};

    const vehicle = {
      name: asString(
        equipment.descricao ?? equipment.label ?? doc.plateOrChassis,
      ),
      plate: asString(
        equipment.placa ?? equipment.chassis ?? doc.plateOrChassis,
      ),
      type: asString(equipment.tipo ?? equipment.linha ?? '—'),
    };

    const readingUnit = doc.measurementType === 'horimetro' ? 'h' : 'km';

    const local =
      doc.latitude && doc.longitude
        ? await reverseGeocode(doc.latitude, doc.longitude)
        : null;

    return {
      id: doc.id,
      dateTime: formatDateTime(doc.createdAt),
      vehicle,
      origin: capitalize(doc.tipo),
      liters: doc.liters,
      pricePerLiter: doc.pricePerLiter ?? null,
      value: doc.total ?? null,
      reading: `${doc.currentReading.toLocaleString('pt-BR')} ${readingUnit}`,
      currentReading: doc.currentReading,
      measurementType: doc.measurementType,
      postoId: doc.postoId ?? null,
      meterPhoto: doc.meterPhoto ?? null,
      local,
      createdAt: doc.createdAt,
    };
  }
}

function capitalize(value: string): string {
  if (!value) return value;
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function asString(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean')
    return String(value);
  return '';
}
