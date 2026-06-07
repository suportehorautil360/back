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

  private get postosCollection() {
    return this.firebaseService.getFirestore().collection('postos');
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
      const uniquePostoIds = [
        ...new Set(
          docs.map((d) => d.postoId?.trim()).filter((id): id is string => !!id),
        ),
      ];

      const [equipmentMap, postoMap] = await Promise.all([
        fetchEquipmentMap(this.equipamentosCollection, uniqueEquipmentIds),
        this.fetchPostoMap(uniquePostoIds),
      ]);

      const data = await Promise.all(
        docs.map((doc) =>
          this.formatAbastecimento(doc, equipmentMap, postoMap),
        ),
      );

      return { data, message: 'Abastecimentos buscados com sucesso!' };
    } catch (error) {
      console.error('Erro ao buscar abastecimentos:', error);
      throw new InternalServerErrorException(
        'Não foi possível buscar os abastecimentos.',
      );
    }
  }

  private async fetchPostoMap(
    ids: string[],
  ): Promise<Map<string, Record<string, unknown>>> {
    const map = new Map<string, Record<string, unknown>>();
    if (!ids.length) return map;

    await Promise.all(
      ids.map(async (id) => {
        const byField = await this.postosCollection
          .where('id', '==', id)
          .limit(1)
          .get();

        if (!byField.empty) {
          map.set(id, byField.docs[0].data());
          return;
        }

        const byDocId = await this.postosCollection.doc(id).get();
        if (byDocId.exists) {
          map.set(id, byDocId.data() as Record<string, unknown>);
        }
      }),
    );

    return map;
  }

  private resolveOrigin(
    doc: AbastecimentoDoc,
    postoMap: Map<string, Record<string, unknown>>,
  ): string {
    if (!doc.postoId?.trim()) {
      return 'Comboio';
    }

    const posto = postoMap.get(doc.postoId.trim());
    const name = asString(posto?.nomeFantasia ?? posto?.name) || 'Credenciado';
    return `Posto ${name}`;
  }

  private async formatAbastecimento(
    doc: AbastecimentoDoc,
    equipmentMap: Map<string, Record<string, unknown>>,
    postoMap: Map<string, Record<string, unknown>>,
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
      origin: this.resolveOrigin(doc, postoMap),
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

function asString(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean')
    return String(value);
  return '';
}
