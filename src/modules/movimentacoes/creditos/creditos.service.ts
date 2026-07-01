import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { FirebaseService } from '../../../config/firebase.service';
import { AbastecimentoDoc } from '../abastecimentos/abastecimentos.service';
import {
  fetchEquipmentMap,
  resolveEquipmentIdByPlateOrChassis,
} from '../shared/equipment.helper';
import { fetchPrefeituraDocs } from '../shared/prefeitura-query.helper';
import { CreateCreditoDto } from './dto/create-credito.dto';
import {
  buildEquipamentoKeywords,
  buildEquipamentoLabel,
  buildFrenteLabel,
  creditTypeLabel,
  formatCreditAmountLabel,
  formatCreditDateLabel,
  parseCreditAmount,
  resolveEquipmentPlateOrChassis,
} from './helpers/creditos-create.helper';
import { buildCreditosSaldosPayload } from './helpers/creditos-saldos.helper';
import type {
  CreditoDoc,
  CreditoFormOpcoes,
  CreditoListItem,
  CreditoOpcaoItem,
  CreditoSaldosPayload,
} from './creditos.types';
import { RESPONSIBLE_OPTIONS } from './creditos.types';

@Injectable()
export class CreditosService {
  constructor(private firebaseService: FirebaseService) {}

  private get collection() {
    return this.firebaseService.getFirestore().collection('creditos');
  }

  private get equipamentosCollection() {
    return this.firebaseService.getFirestore().collection('equipamentos');
  }

  private get workFrontsCollection() {
    return this.firebaseService.getFirestore().collection('work-fronts');
  }

  private get abastecimentosCollection() {
    return this.firebaseService.getFirestore().collection('abastecimentos');
  }

  private get allocationsCollection() {
    return this.firebaseService.getFirestore().collection('allocations');
  }

  async create(input: CreateCreditoDto): Promise<CreditoDoc> {
    const amount = parseCreditAmount(input.amount);
    if (amount === null) {
      throw new BadRequestException(
        'The field amount must be greater than zero.',
      );
    }

    const target = await this.resolveTarget(input);

    const id = randomUUID();
    const doc: CreditoDoc = {
      id,
      prefeituraId: input.prefeituraId.trim(),
      type: input.type,
      equipmentId: target.equipmentId,
      plateOrChassis:
        input.type === 'equipment' ? input.plateOrChassis!.trim() : null,
      workFrontId: input.type === 'workFront' ? input.workFrontId! : null,
      targetLabel: target.label,
      amount,
      responsible: input.responsible.trim(),
      observation: input.observation?.trim() || undefined,
      createdAt: new Date().toISOString(),
    };

    try {
      await this.collection.doc(id).set(doc);
      return doc;
    } catch (error) {
      console.error('Erro ao criar crédito:', error);
      throw new InternalServerErrorException(
        'Não foi possível lançar o crédito.',
      );
    }
  }

  async listarOpcoesFormulario(
    prefeituraId: string,
  ): Promise<{ data: CreditoFormOpcoes; message: string }> {
    try {
      const [equipment, workFronts] = await Promise.all([
        this.listarEquipamentosOpcoes(prefeituraId),
        this.listarFrentesOpcoes(prefeituraId),
      ]);

      return {
        data: {
          typeOptions: [
            { value: 'equipment', label: 'Equipamento' },
            { value: 'workFront', label: 'Frente de trabalho' },
          ],
          equipment,
          workFronts,
          responsibleOptions: [...RESPONSIBLE_OPTIONS],
          suggestedAmounts: [200, 500, 1000, 2000, 5000],
        },
        message: 'Opções do formulário carregadas com sucesso!',
      };
    } catch (error) {
      console.error('Erro ao buscar opções de crédito:', error);
      throw new InternalServerErrorException(
        'Não foi possível carregar as opções do formulário.',
      );
    }
  }

  async listarSaldos(
    prefeituraId: string,
  ): Promise<{ data: CreditoSaldosPayload; message: string }> {
    try {
      const [
        creditosSnap,
        abastecimentosSnap,
        allocationsSnap,
        workFrontsSnap,
      ] = await Promise.all([
        this.collection.where('prefeituraId', '==', prefeituraId).get(),
        this.abastecimentosCollection
          .where('prefeituraId', '==', prefeituraId)
          .get(),
        this.allocationsCollection
          .where('prefeituraId', '==', prefeituraId)
          .get(),
        this.workFrontsCollection
          .where('prefeituraId', '==', prefeituraId)
          .get(),
      ]);

      const creditos = creditosSnap.docs.map((doc) => doc.data() as CreditoDoc);
      const abastecimentos = abastecimentosSnap.docs.map(
        (doc) => doc.data() as AbastecimentoDoc,
      );
      const allocations = allocationsSnap.docs.map((doc) => {
        const raw = doc.data() as Record<string, unknown>;
        return {
          vehicleId: asString(raw.vehicleId),
          workFrontId: asString(raw.workFrontId),
          workFrontName: asString(raw.workFrontName),
        };
      });

      const workFrontNames = new Map<string, string>();
      workFrontsSnap.docs.forEach((doc) => {
        const raw = doc.data() as Record<string, unknown>;
        const id = asString(raw.id ?? doc.id);
        if (!id) return;
        workFrontNames.set(id, buildFrenteLabel(raw));
      });

      const equipmentIds = [
        ...new Set([
          ...creditos
            .map((item) => item.equipmentId)
            .filter((id): id is string => !!id),
          ...abastecimentos.map((item) => item.equipmentId).filter(Boolean),
          ...allocations.map((item) => item.vehicleId).filter(Boolean),
        ]),
      ];

      const equipmentMap = await fetchEquipmentMap(
        this.equipamentosCollection,
        equipmentIds,
      );

      const data = buildCreditosSaldosPayload({
        creditos,
        abastecimentos: abastecimentos.map((item) => {
          const raw = item as unknown as Record<string, unknown>;
          return {
            equipmentId: item.equipmentId,
            total: item.total ?? null,
            status: asString(raw.status) || null,
          };
        }),
        allocations: allocations.filter(
          (item) => item.vehicleId && item.workFrontId,
        ),
        equipmentMap,
        workFrontNames,
      });

      return { data, message: 'Saldos de crédito buscados com sucesso!' };
    } catch (error) {
      console.error('Erro ao buscar saldos de crédito:', error);
      throw new InternalServerErrorException(
        'Não foi possível buscar os saldos de crédito.',
      );
    }
  }

  async listarPorPrefeitura(
    prefeituraId: string,
  ): Promise<{ data: CreditoListItem[]; message: string }> {
    try {
      const docs = await fetchPrefeituraDocs<CreditoDoc>(
        this.collection,
        prefeituraId,
        { order: 'desc' },
      );

      const data = docs.map((doc) => this.mapToListItem(doc));

      return { data, message: 'Créditos buscados com sucesso!' };
    } catch (error) {
      console.error('Erro ao buscar créditos:', error);
      throw new InternalServerErrorException(
        'Não foi possível buscar os créditos.',
      );
    }
  }

  private async resolveTarget(
    input: CreateCreditoDto,
  ): Promise<{ label: string; equipmentId: string | null }> {
    if (input.type === 'equipment') {
      if (!input.plateOrChassis?.trim()) {
        throw new BadRequestException(
          'The field plateOrChassis is required when type = equipment.',
        );
      }
      if (input.workFrontId) {
        throw new BadRequestException(
          'Do not send workFrontId when type = equipment.',
        );
      }

      const plateOrChassis = input.plateOrChassis.trim();
      const equipmentId = await resolveEquipmentIdByPlateOrChassis(
        this.equipamentosCollection,
        input.prefeituraId,
        plateOrChassis,
      );

      return {
        label: buildEquipamentoLabel(
          await this.findEquipamentoRaw(input.prefeituraId, equipmentId),
        ),
        equipmentId,
      };
    }

    if (!input.workFrontId?.trim()) {
      throw new BadRequestException(
        'The field workFrontId is required when type = workFront.',
      );
    }
    if (input.plateOrChassis) {
      throw new BadRequestException(
        'Do not send plateOrChassis when type = workFront.',
      );
    }

    const workFront = await this.findFrenteTrabalho(
      input.prefeituraId,
      input.workFrontId.trim(),
    );
    return { label: buildFrenteLabel(workFront), equipmentId: null };
  }

  private async findEquipamentoRaw(
    prefeituraId: string,
    equipmentId: string,
  ): Promise<Record<string, unknown>> {
    const byField = await this.equipamentosCollection
      .where('id', '==', equipmentId)
      .where('prefeituraId', '==', prefeituraId.trim())
      .limit(1)
      .get();

    if (!byField.empty) {
      return byField.docs[0].data();
    }

    const byDocId = await this.equipamentosCollection.doc(equipmentId).get();
    if (byDocId.exists) {
      const raw = byDocId.data() as Record<string, unknown>;
      if (asString(raw.prefeituraId) === prefeituraId.trim()) {
        return raw;
      }
    }

    const snap = await this.equipamentosCollection
      .where('prefeituraId', '==', prefeituraId.trim())
      .get();

    const match = snap.docs.find((doc) => {
      const raw = doc.data() as Record<string, unknown>;
      return (
        asString(raw.id ?? doc.id) === equipmentId || doc.id === equipmentId
      );
    });

    if (match) {
      return match.data();
    }

    throw new NotFoundException(
      'Equipamento não encontrado ou não cadastrado para esta empresa.',
    );
  }

  private async findFrenteTrabalho(
    prefeituraId: string,
    workFrontId: string,
  ): Promise<Record<string, unknown>> {
    const snap = await this.workFrontsCollection
      .where('id', '==', workFrontId)
      .where('prefeituraId', '==', prefeituraId)
      .limit(1)
      .get();

    if (snap.empty) {
      throw new NotFoundException(
        'Frente de trabalho não encontrada para esta prefeitura.',
      );
    }

    return snap.docs[0].data();
  }

  private async listarEquipamentosOpcoes(
    prefeituraId: string,
  ): Promise<CreditoOpcaoItem[]> {
    const snap = await this.equipamentosCollection
      .where('prefeituraId', '==', prefeituraId)
      .get();

    return snap.docs
      .map((doc) => {
        const raw = doc.data() as Record<string, unknown>;
        const id =
          resolveEquipmentPlateOrChassis(raw) || asString(raw.id ?? doc.id);
        return {
          id,
          label: buildEquipamentoLabel(raw),
          keywords: buildEquipamentoKeywords(raw),
        };
      })
      .filter((item) => item.id)
      .sort((a, b) => a.label.localeCompare(b.label, 'pt-BR'));
  }

  private async listarFrentesOpcoes(
    prefeituraId: string,
  ): Promise<CreditoOpcaoItem[]> {
    const snap = await this.workFrontsCollection
      .where('prefeituraId', '==', prefeituraId)
      .get();

    return snap.docs
      .map((doc) => {
        const raw = doc.data() as Record<string, unknown>;
        const id = asString(raw.id ?? doc.id);
        return {
          id,
          label: buildFrenteLabel(raw),
        };
      })
      .filter((item) => item.id)
      .sort((a, b) => a.label.localeCompare(b.label, 'pt-BR'));
  }

  private mapToListItem(doc: CreditoDoc): CreditoListItem {
    return {
      id: doc.id,
      type: doc.type,
      typeLabel: creditTypeLabel(doc.type),
      targetLabel: doc.targetLabel,
      amount: doc.amount,
      amountLabel: formatCreditAmountLabel(doc.amount),
      responsible: doc.responsible,
      observation: doc.observation ?? null,
      createdAt: doc.createdAt,
      dateLabel: formatCreditDateLabel(doc.createdAt),
    };
  }
}

function asString(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return '';
}
