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
import { CreateAbastecimentoMotoristaDto } from './dto/create-abastecimento-motorista.dto';
import {
  capacidadeAlvoAbastecimento,
  deveAtualizarMedicaoAtual,
  ehComboio,
  isSupportedMeasurementType,
  maiorLeituraRegistrada,
  parseLiters,
  resolveAbastecimentoPricing,
} from './helpers/abastecimentos-create.helper';
import {
  mensagemIntervaloAbastecimento,
  ultimoAbastecimentoTimestampMs,
  verificarIntervaloAbastecimento,
} from './helpers/intervalo-abastecimento.helper';
import {
  fetchEquipmentMap,
  resolveEquipmentById,
  resolveEquipmentByPlateOrChassis,
} from '../shared/equipment.helper';
import { debitarTanqueTx } from '../shared/tank-saldo.helper';
import {
  formatDateTime,
  parseDateEnd,
  parseDateStart,
} from '../shared/date.helper';
import {
  createdAtToIso,
  fetchPrefeituraDocs,
} from '../shared/prefeitura-query.helper';
import { reverseGeocode } from '../shared/reverse-geocode.helper';
import { ehCombustivelDiesel } from '../../fleetfuel/helpers/fleetfuel-rules.helper';
import {
  formatReadingLabel,
  resolveCurrentReading,
  resolveLiters,
} from './abastecimentos.mapper';

export interface AbastecimentoDoc {
  id: string;
  prefeituraId: string;
  equipmentId: string;
  plateOrChassis: string;
  liters: number;
  tipo: string;
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
  /** Posto avulso (não credenciado) — nome informado pelo motorista. */
  postoNome?: string;
  /** Foto do cupom fiscal. */
  receiptPhoto?: string;
  /** manual_motorista | comboio | fleetfuel */
  origem?: string;
  /** pendente_aprovacao | aprovado | rejeitado */
  status?: string;
  /** Nome do condutor (denormalizado). */
  motoristaNome?: string;
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

  private get funcionariosCollection() {
    return this.firebaseService.getFirestore().collection('funcionarios');
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

    if (!ehCombustivelDiesel(equipamento.raw.combustivel)) {
      throw new BadRequestException(
        'O comboio só abastece equipamentos a diesel. Verifique o combustível cadastrado no equipamento.',
      );
    }

    // Não abastecer mais do que o tanque ALVO comporta. Para comboio o alvo é o
    // tanque do próprio caminhão (capacidadeTanqueCaminhao); para os demais, o
    // tanque do equipamento (capacidadeTanque). A origem (reservatório/posto) é
    // tratada à parte. Capacidade ausente/0 = sem limite.
    const capacidadeAlvo = capacidadeAlvoAbastecimento(equipamento.raw);
    if (capacidadeAlvo > 0 && liters > capacidadeAlvo) {
      const ondeCabe = ehComboio(equipamento.raw.tipo)
        ? 'tanque do caminhão do comboio'
        : 'tanque do equipamento';
      throw new BadRequestException(
        `Acima da capacidade do ${ondeCabe}: ${liters} L solicitado(s), ` +
          `capacidade ${capacidadeAlvo} L.`,
      );
    }

    // A leitura (horímetro/km) não pode ser igual ou menor que a última já
    // registrada para o equipamento — horímetro e hodômetro só aumentam.
    const leituraNova = Number(input.currentReading);
    const ultima = await this.ultimaLeitura(
      input.prefeituraId,
      equipmentId,
      input.measurementType,
    );
    if (ultima !== null && leituraNova <= ultima) {
      const unidade = input.measurementType === 'horimetro' ? 'h' : 'km';
      throw new BadRequestException(
        `A leitura (${leituraNova.toLocaleString('pt-BR')} ${unidade}) deve ser maior ` +
          `que a última registrada para este equipamento (${ultima.toLocaleString('pt-BR')} ${unidade}).`,
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

      // Mantém a "KM/horímetro atual" (medicaoAtual) do equipamento em dia com a
      // leitura do abastecimento — alimenta o painel e serve de baseline offline
      // no app. Best-effort (denormalizado): se falhar, não derruba o registro.
      if (
        deveAtualizarMedicaoAtual(
          equipamento.raw.unidadeRevisao,
          input.measurementType,
          equipamento.raw.medicaoAtual,
          leituraNova,
        )
      ) {
        await equipamento.ref
          .set({ medicaoAtual: leituraNova }, { merge: true })
          .catch((e) =>
            console.error('Falha ao atualizar medicaoAtual do equipamento:', e),
          );
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

  /**
   * Abastecimento manual do motorista em posto avulso (não credenciado).
   * Fica `pendente_aprovacao` — não debita crédito até aprovação no 360.
   */
  async createManualMotorista(
    input: CreateAbastecimentoMotoristaDto,
  ): Promise<AbastecimentoDoc> {
    const liters = parseLiters(input.liters);
    if (liters === null) {
      throw new BadRequestException('O campo liters deve ser maior que zero.');
    }

    if (!isSupportedMeasurementType(input.measurementType)) {
      throw new BadRequestException(
        'O campo measurementType deve ser horimetro ou hodometro.',
      );
    }

    const postoNome = input.postoNome?.trim();
    if (!postoNome || postoNome.length < 2) {
      throw new BadRequestException('Informe o nome do posto.');
    }

    if (!input.meterPhoto?.trim()) {
      throw new BadRequestException('A foto do medidor é obrigatória.');
    }
    if (!input.receiptPhoto?.trim()) {
      throw new BadRequestException('A foto do cupom é obrigatória.');
    }

    if (!Number.isFinite(Number(input.currentReading))) {
      throw new BadRequestException(
        'Informe a leitura atual (currentReading).',
      );
    }

    const equipamento = await resolveEquipmentById(
      this.equipamentosCollection,
      input.prefeituraId,
      input.equipmentId,
    );
    const equipmentId = equipamento.id;

    if (!motoristaEhCondutor(equipamento.raw, input.funcionarioId)) {
      throw new BadRequestException(
        'Você não é condutor responsável deste equipamento.',
      );
    }

    const plateOrChassis = resolvePlateOrChassis(equipamento.raw);
    if (!plateOrChassis) {
      throw new BadRequestException(
        'Equipamento sem placa ou chassi cadastrado.',
      );
    }

    await this.assertIntervaloMinimoAbastecimento(
      input.prefeituraId,
      equipmentId,
    );

    const capacidadeAlvo = capacidadeAlvoAbastecimento(equipamento.raw);
    if (capacidadeAlvo > 0 && liters > capacidadeAlvo) {
      const ondeCabe = ehComboio(equipamento.raw.tipo)
        ? 'tanque do caminhão do comboio'
        : 'tanque do equipamento';
      throw new BadRequestException(
        `Acima da capacidade do ${ondeCabe}: ${liters} L solicitado(s), ` +
          `capacidade ${capacidadeAlvo} L.`,
      );
    }

    const leituraNova = Number(input.currentReading);
    const ultima = await this.ultimaLeitura(
      input.prefeituraId,
      equipmentId,
      input.measurementType,
    );
    if (ultima !== null && leituraNova <= ultima) {
      const unidade = input.measurementType === 'horimetro' ? 'h' : 'km';
      throw new BadRequestException(
        `A leitura (${leituraNova.toLocaleString('pt-BR')} ${unidade}) deve ser maior ` +
          `que a última registrada para este equipamento (${ultima.toLocaleString('pt-BR')} ${unidade}).`,
      );
    }

    const pricing = resolveAbastecimentoPricing(
      liters,
      input.pricePerLiter,
      input.total,
    );

    const id = input.id?.trim() || randomUUID();
    const motoristaNome = await this.buscarNomeFuncionario(input.funcionarioId);

    const doc: AbastecimentoDoc = {
      id,
      prefeituraId: input.prefeituraId,
      equipmentId,
      plateOrChassis,
      liters,
      tipo: 'manual_motorista',
      measurementType: input.measurementType,
      currentReading: leituraNova,
      meterPhoto: input.meterPhoto.trim(),
      receiptPhoto: input.receiptPhoto.trim(),
      pricePerLiter: pricing.pricePerLiter,
      total: pricing.total,
      postoNome,
      funcionarioId: input.funcionarioId.trim(),
      motoristaNome,
      origem: 'manual_motorista',
      status: 'pendente_aprovacao',
      latitude: input.latitude,
      longitude: input.longitude,
      createdAt: new Date().toISOString(),
    };

    try {
      await this.collection.doc(id).set(doc);

      if (
        deveAtualizarMedicaoAtual(
          equipamento.raw.unidadeRevisao,
          input.measurementType,
          equipamento.raw.medicaoAtual,
          leituraNova,
        )
      ) {
        await equipamento.ref
          .set({ medicaoAtual: leituraNova }, { merge: true })
          .catch((e) =>
            console.error('Falha ao atualizar medicaoAtual do equipamento:', e),
          );
      }

      return doc;
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      console.error('Erro ao criar abastecimento manual do motorista:', error);
      throw new InternalServerErrorException(
        'Não foi possível registrar o abastecimento.',
      );
    }
  }

  private async buscarNomeFuncionario(funcionarioId: string): Promise<string> {
    const id = funcionarioId.trim();
    if (!id) return '';
    try {
      const snap = await this.funcionariosCollection.doc(id).get();
      if (!snap.exists) return '';
      const raw = snap.data() as Record<string, unknown>;
      return asString(raw.nome);
    } catch {
      return '';
    }
  }

  /** Impede novo abastecimento do mesmo veículo antes de 3 horas. */
  private async assertIntervaloMinimoAbastecimento(
    prefeituraId: string,
    equipmentId: string,
  ): Promise<void> {
    const snap = await this.collection
      .where('equipmentId', '==', equipmentId)
      .get();
    const docs = snap.docs.map((d) => d.data() as AbastecimentoDoc);
    const ultimoEmMs = ultimoAbastecimentoTimestampMs(
      docs,
      prefeituraId,
      equipmentId,
    );
    const status = verificarIntervaloAbastecimento(ultimoEmMs);
    if (!status.liberado && status.proximoEmMs !== null) {
      throw new BadRequestException(
        mensagemIntervaloAbastecimento(status.proximoEmMs),
      );
    }
  }

  /**
   * Maior leitura já registrada para o equipamento naquele tipo de medição
   * (horímetro/hodômetro). `null` se ainda não houver nenhum abastecimento — aí
   * não há referência e qualquer leitura é aceita. Filtra em memória (sem índice
   * composto), no padrão do módulo.
   */
  async ultimaLeitura(
    prefeituraId: string,
    equipmentId: string,
    measurementType: TipoMedicao,
  ): Promise<number | null> {
    if (!equipmentId) return null;
    const snap = await this.collection
      .where('equipmentId', '==', equipmentId)
      .get();
    const docs = snap.docs.map((d) => d.data() as AbastecimentoDoc);
    return maiorLeituraRegistrada(docs, prefeituraId, measurementType);
  }

  /**
   * Última leitura por placa/chassi — para o app validar a próxima leitura antes
   * de enviar. Equipamento fora do cadastro ou tipo inválido → `null` (sem
   * referência, não bloqueia no app; o create é o gate final).
   */
  async ultimaLeituraPorPlaca(
    prefeituraId: string,
    plateOrChassis: string,
    measurementType: string,
  ): Promise<{ ultimaLeitura: number | null; measurementType: string }> {
    if (
      !plateOrChassis?.trim() ||
      !isSupportedMeasurementType(measurementType)
    ) {
      return { ultimaLeitura: null, measurementType };
    }
    try {
      const equip = await resolveEquipmentByPlateOrChassis(
        this.equipamentosCollection,
        prefeituraId,
        plateOrChassis,
      );
      const ultimaLeitura = await this.ultimaLeitura(
        prefeituraId,
        equip.id,
        measurementType,
      );
      return { ultimaLeitura, measurementType };
    } catch {
      // Equipamento não encontrado: sem referência (o app não bloqueia).
      return { ultimaLeitura: null, measurementType };
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

      const data = await this.formatAbastecimentosDocs(docs);
      return { data, message: 'Abastecimentos buscados com sucesso!' };
    } catch (error) {
      console.error('Erro ao buscar abastecimentos:', error);
      throw new InternalServerErrorException(
        'Não foi possível buscar os abastecimentos.',
      );
    }
  }

  /** Histórico do posto credenciado (portal posto-web). */
  async listarPorPosto(
    postoId: string,
    startDate?: string,
    endDate?: string,
  ) {
    const id = postoId.trim();
    if (!id) {
      throw new BadRequestException('postoId inválido.');
    }

    try {
      const snap = await this.collection.where('postoId', '==', id).get();

      let docs = snap.docs.map((doc) => {
        const data = doc.data() as Record<string, unknown>;
        return {
          ...data,
          id: asString(data.id) || doc.id,
          createdAt: createdAtToIso(data.createdAt) || createdAtToIso(data.criadoEm),
        } as AbastecimentoDoc;
      });

      if (startDate) {
        const startIso = parseDateStart(startDate, 'startDate').toISOString();
        docs = docs.filter((d) => d.createdAt && d.createdAt >= startIso);
      }
      if (endDate) {
        const endIso = parseDateEnd(endDate, 'endDate').toISOString();
        docs = docs.filter((d) => d.createdAt && d.createdAt <= endIso);
      }

      docs.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));

      const data = await this.formatAbastecimentosDocs(docs);
      return {
        data,
        message: 'Abastecimentos do posto buscados com sucesso!',
      };
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      console.error('Erro ao buscar abastecimentos do posto:', error);
      throw new InternalServerErrorException(
        'Não foi possível buscar os abastecimentos do posto.',
      );
    }
  }

  private async formatAbastecimentosDocs(docs: AbastecimentoDoc[]) {
    if (docs.length === 0) return [];

    const uniqueEquipmentIds = [
      ...new Set(
        docs
          .map((d) => {
            const raw = d as unknown as Record<string, unknown>;
            return asString(d.equipmentId ?? raw.equipamentoId);
          })
          .filter(Boolean),
      ),
    ];
    const uniquePostoIds = [
      ...new Set(
        docs.map((d) => d.postoId?.trim()).filter((pid): pid is string => !!pid),
      ),
    ];

    const [equipmentMap, postoMap] = await Promise.all([
      fetchEquipmentMap(this.equipamentosCollection, uniqueEquipmentIds),
      this.fetchPostoMap(uniquePostoIds),
    ]);

    return Promise.all(
      docs.map((doc) => this.formatAbastecimento(doc, equipmentMap, postoMap)),
    );
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
    const raw = doc as unknown as Record<string, unknown>;
    if (!doc.postoId?.trim()) {
      if (raw.origem === 'comboio' || raw.tipo === 'comboio') {
        return 'Comboio';
      }
      const postoNome = asString(raw.postoNome ?? raw.local);
      if (postoNome) {
        const lower = postoNome.toLowerCase();
        if (lower.startsWith('posto ')) return postoNome;
        return `Posto ${postoNome}`;
      }
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
    const raw = doc as unknown as Record<string, unknown>;
    const equipmentId = asString(doc.equipmentId ?? raw.equipamentoId);
    const equipment = equipmentMap.get(equipmentId) ?? {};
    const plateOrChassis = asString(
      doc.plateOrChassis ?? raw.placa ?? raw.chassis,
    );

    const vehicle = {
      name: asString(
        equipment.descricao ??
          equipment.label ??
          raw.veiculo ??
          plateOrChassis,
      ),
      plate: asString(
        equipment.placa ?? equipment.chassis ?? plateOrChassis,
      ),
      type: asString(equipment.tipo ?? equipment.linha ?? raw.tipoVeiculo ?? '—'),
    };

    const readingLabel = formatReadingLabel(raw);
    const currentReading = resolveCurrentReading(raw);

    const local =
      doc.latitude && doc.longitude
        ? await reverseGeocode(doc.latitude, doc.longitude)
        : asString(raw.local) || null;

    return {
      id: doc.id,
      dateTime: formatDateTime(doc.createdAt),
      vehicle,
      origin: this.resolveOrigin(doc, postoMap),
      fuelType:
        asString(raw.tipoCombustivel) ||
        asString(raw.combustivel) ||
        asString(equipment.combustivel) ||
        null,
      motoristaNome:
        asString(raw.motoristaNome) ||
        asString(raw.motorista) ||
        null,
      liters: resolveLiters(raw),
      pricePerLiter: doc.pricePerLiter ?? null,
      value: doc.total ?? null,
      // Docs legados podem não ter currentReading — os helpers resolvem leitura
      // (currentReading/leitura/km/horimetro) e devolvem null/'—' sem derrubar a
      // listagem inteira (500).
      reading: readingLabel ?? '—',
      currentReading,
      measurementType: doc.measurementType ?? null,
      postoId: doc.postoId ?? null,
      comboioId: doc.comboioId ?? null,
      funcionarioId: doc.funcionarioId ?? null,
      meterPhoto: doc.meterPhoto ?? null,
      local,
      latitude:
        doc.latitude != null && Number.isFinite(Number(doc.latitude))
          ? Number(doc.latitude)
          : null,
      longitude:
        doc.longitude != null && Number.isFinite(Number(doc.longitude))
          ? Number(doc.longitude)
          : null,
      createdAt: doc.createdAt,
      status: asString(raw.status) || 'aprovado',
    };
  }
}

function asString(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean')
    return String(value);
  return '';
}

function motoristaEhCondutor(
  equipamento: Record<string, unknown>,
  motoristaId: string,
): boolean {
  const lista = Array.isArray(equipamento.condutoresResponsaveis)
    ? equipamento.condutoresResponsaveis
    : [];
  return lista.some((id) => id === motoristaId);
}

function resolvePlateOrChassis(raw: Record<string, unknown>): string {
  const placa = asString(raw.placa);
  if (placa) return placa;
  return asString(raw.chassis);
}
