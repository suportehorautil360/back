import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
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
  resolveEquipmentByPlateOrChassis,
} from '../shared/equipment.helper';
import { debitarTanqueTx } from '../shared/tank-saldo.helper';
import { formatDateTime } from '../shared/date.helper';
import { fetchPrefeituraDocs } from '../shared/prefeitura-query.helper';
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
  /** Comboio cujo tanque foi debitado (quando o combustível sai do comboio). */
  comboioId?: string;
  /** Funcionário (comboista) que registrou o abastecimento. */
  funcionarioId?: string;
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

    if (!input.plateOrChassis?.trim()) {
      throw new BadRequestException(
        'Informe a placa ou chassi do equipamento.',
      );
    }

    if (!Number.isFinite(Number(input.currentReading))) {
      throw new BadRequestException(
        'Informe a leitura atual (currentReading).',
      );
    }

    const equipamento = await resolveEquipmentByPlateOrChassis(
      this.equipamentosCollection,
      input.prefeituraId,
      input.plateOrChassis,
    );
    const equipmentId = equipamento.id;

    // Não abastecer mais do que o tanque do equipamento comporta (vale com ou
    // sem posto — o destino é sempre o tanque do equipamento). Capacidade
    // ausente/0 = sem limite (equipamento sem capacidadeTanque cadastrada).
    if (
      equipamento.capacidadeTanque > 0 &&
      liters > equipamento.capacidadeTanque
    ) {
      throw new BadRequestException(
        `Acima da capacidade do tanque do equipamento: ${liters} L solicitado(s), ` +
          `capacidade ${equipamento.capacidadeTanque} L.`,
      );
    }

    const pricing = resolveAbastecimentoPricing(
      liters,
      input.pricePerLiter,
      input.total,
    );

    const id = randomUUID();
    const postoId = input.postoId?.trim() || undefined;
    const comboioId = input.comboioId?.trim() || undefined;

    // Sem posto, o combustível sai do comboio: precisamos saber qual tanque
    // debitar (e travar saldo negativo).
    if (!postoId && !comboioId) {
      throw new BadRequestException(
        'Informe o comboio (comboioId) do qual o combustível foi retirado.',
      );
    }

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
      postoId,
      comboioId,
      funcionarioId: input.funcionarioId?.trim() || undefined,
      latitude: input.latitude,
      longitude: input.longitude,
      createdAt: new Date().toISOString(),
    };

    const firestore = this.firebaseService.getFirestore();
    try {
      if (postoId) {
        // Posto credenciado: o combustível não sai do comboio, não mexe no tanque.
        await this.collection.doc(id).set(doc);
      } else {
        // Sai do comboio: grava o registro e debita o tanque na mesma transação
        // (rejeita se faltar saldo — o tanque nunca fica negativo).
        await firestore.runTransaction(async (tx) => {
          await debitarTanqueTx(tx, firestore, comboioId as string, liters);
          tx.set(this.collection.doc(id), doc);
        });
      }
      return doc;
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      console.error('Erro ao criar abastecimento:', error);
      throw new InternalServerErrorException(
        'Não foi possível registrar o abastecimento.',
      );
    }
  }

  /** Lista os abastecimentos da prefeitura formatados para a tela. */
  async listar(prefeituraId: string, startDate?: string, endDate?: string) {
    try {
      const docs = await fetchPrefeituraDocs<AbastecimentoDoc>(
        this.collection,
        prefeituraId,
        { startDate, endDate, order: 'desc' },
      );

      if (docs.length === 0) {
        return { data: [], message: 'Abastecimentos buscados com sucesso!' };
      }

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

  /**
   * Remove um abastecimento. NÃO reverte o saldo do tanque (uso de limpeza de
   * registros). Ajuste o tanque manualmente se necessário.
   */
  async remover(id: string) {
    try {
      const ref = this.collection.doc(id);
      const snap = await ref.get();
      if (!snap.exists) {
        throw new NotFoundException('Abastecimento não encontrado.');
      }
      await ref.delete();
      return { data: { id }, message: 'Abastecimento removido.' };
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      console.error('Erro ao remover abastecimento:', error);
      throw new InternalServerErrorException(
        'Não foi possível remover o abastecimento.',
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
      // Docs legados podem não ter currentReading — um só não pode derrubar a
      // listagem inteira (500). Tolera ausência.
      reading:
        doc.currentReading != null
          ? `${Number(doc.currentReading).toLocaleString('pt-BR')} ${readingUnit}`
          : '—',
      currentReading: doc.currentReading ?? null,
      measurementType: doc.measurementType,
      postoId: doc.postoId ?? null,
      comboioId: doc.comboioId ?? null,
      funcionarioId: doc.funcionarioId ?? null,
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
