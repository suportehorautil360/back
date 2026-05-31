import {
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { v4 as uuid } from 'uuid';
import { FirebaseService } from '../../config/firebase.service';
import {
  CreateEmergencyDto,
  EmergencySeverity,
  EmergencySource,
  EmergencyStatus,
} from './dto/create-emergency.dto';

export interface EmergencyDoc {
  id: string;
  prefeituraId: string;
  source: EmergencySource;
  severity: EmergencySeverity;
  equipamentoId: string | null;
  idMaquina: string | null;
  chassis: string;
  operadorNome: string;
  operador: string;
  tipoFalha: string;
  descricao: string;
  localizacaoGps: string | null;
  statusAtendimento: EmergencyStatus;
  fotos: string[];
  qtdFotos: number;
  checklistRunId: string | null;
  checklistId: string | null;
  questionId: string | null;
  questionLabel: string | null;
  answerValue?: unknown;
  dataHoraIso: string;
  createdAt: string;
  updatedAt: string;
}

type EmergencyFilters = {
  date?: string;
  chassis?: string;
  operator?: string;
};

function normalizeEmergencyStatus(status: string | undefined): EmergencyStatus {
  const s = String(status ?? '')
    .trim()
    .toLowerCase();
  if (s === 'resolvido') return 'RESOLVIDO';
  if (s === 'em_atendimento' || s === 'em atendimento') return 'EM_ATENDIMENTO';
  if (s === 'cancelado') return 'CANCELADO';
  return 'ABERTO';
}

@Injectable()
export class EmergenciesService {
  constructor(private firebase: FirebaseService) {}

  private get collection() {
    return this.firebase.getFirestore().collection('emergenciasRegistros');
  }

  async create(dto: CreateEmergencyDto) {
    const id = uuid();
    const agora = new Date().toISOString();
    const fotos = Array.isArray(dto.fotos)
      ? dto.fotos.filter((foto) => typeof foto === 'string' && foto.length > 0)
      : [];
    const equipamentoId = dto.equipamentoId?.trim() || null;
    const doc: EmergencyDoc = {
      id,
      prefeituraId: dto.prefeituraId,
      source: dto.source ?? 'manual',
      severity: dto.severity ?? 'critical',
      equipamentoId,
      idMaquina: equipamentoId,
      chassis: dto.chassis?.trim() ?? '',
      operadorNome: dto.operadorNome,
      operador: dto.operadorNome,
      tipoFalha: dto.tipoFalha,
      descricao: dto.descricao,
      localizacaoGps: dto.localizacaoGps?.trim() || null,
      statusAtendimento: 'ABERTO',
      fotos,
      qtdFotos: fotos.length,
      checklistRunId: dto.checklistRunId ?? null,
      checklistId: dto.checklistId ?? null,
      questionId: dto.questionId ?? null,
      questionLabel: dto.questionLabel ?? null,
      answerValue: dto.answerValue,
      dataHoraIso: agora,
      createdAt: agora,
      updatedAt: agora,
    };

    try {
      await this.collection.doc(id).set(doc);
      return { data: doc, message: 'Emergência registrada com sucesso.' };
    } catch (error) {
      console.error('Erro ao registrar emergência:', error);
      throw new InternalServerErrorException(
        'Não foi possível registrar a emergência.',
      );
    }
  }

  async listByPrefeitura(prefeituraId: string, filters?: EmergencyFilters) {
    try {
      const snap = await this.collection
        .where('prefeituraId', '==', prefeituraId)
        .get();
      const rows = snap.docs
        .map((doc) => this.mapFirestoreDoc(doc.id, doc.data()))
        .filter((row) => this.matchesFilters(row, filters))
        .sort((a, b) => b.dataHoraIso.localeCompare(a.dataHoraIso));
      return { data: rows, message: 'Emergências carregadas.' };
    } catch (error) {
      console.error('Erro ao listar emergências:', error);
      throw new InternalServerErrorException(
        'Não foi possível listar as emergências.',
      );
    }
  }

  async updateStatus(id: string, status: string) {
    const normalized = normalizeEmergencyStatus(status);
    const ref = this.collection.doc(id);
    const snap = await ref.get();
    if (!snap.exists) {
      throw new NotFoundException('Emergência não encontrada.');
    }
    await ref.update({
      statusAtendimento: normalized,
      updatedAt: new Date().toISOString(),
    });
    return {
      data: { id, statusAtendimento: normalized },
      message: 'Status da emergência atualizado.',
    };
  }

  private mapFirestoreDoc(id: string, data: FirebaseFirestore.DocumentData) {
    const statusAtendimento = normalizeEmergencyStatus(
      String(data.statusAtendimento ?? data.Status_Atendimento ?? ''),
    );
    const fotos = Array.isArray(data.fotos)
      ? data.fotos.filter(
          (foto: unknown): foto is string => typeof foto === 'string',
        )
      : [];
    return {
      id,
      ...data,
      prefeituraId: String(data.prefeituraId ?? ''),
      operadorNome: String(data.operadorNome ?? data.operador ?? '—'),
      operador: String(data.operador ?? data.operadorNome ?? '—'),
      chassis: String(data.chassis ?? ''),
      equipamentoId: String(data.equipamentoId ?? data.idMaquina ?? ''),
      idMaquina: String(data.idMaquina ?? data.equipamentoId ?? ''),
      tipoFalha: String(data.tipoFalha ?? data.Tipo_Falha ?? '—'),
      descricao: String(data.descricao ?? data.Descricao_Curta ?? '—'),
      localizacaoGps: this.toNullableString(
        data.localizacaoGps ?? data.Localizacao_GPS,
      ),
      fotos,
      qtdFotos: Number(
        data.qtdFotos ?? data.Qtd_Fotos_Evidencia ?? fotos.length,
      ),
      statusAtendimento,
      dataHoraIso: String(data.dataHoraIso ?? data.Data_Hora ?? ''),
    };
  }

  private matchesFilters(
    row: {
      dataHoraIso?: string;
      chassis?: string;
      operador?: string;
      operadorNome?: string;
      createdAt?: string;
    },
    filters?: EmergencyFilters,
  ): boolean {
    const filtroData = this.normalizeText(filters?.date);
    const filtroChassis = this.normalizeText(filters?.chassis);
    const filtroOperador = this.normalizeText(filters?.operator);

    if (filtroData && !this.matchesDateFilter(row, filtroData)) {
      return false;
    }

    if (filtroChassis) {
      const chassis = this.normalizeText(row.chassis);
      if (!chassis.includes(filtroChassis)) {
        return false;
      }
    }

    if (filtroOperador) {
      const operador = this.normalizeText(row.operador || row.operadorNome);
      if (!operador.includes(filtroOperador)) {
        return false;
      }
    }

    return true;
  }

  private matchesDateFilter(
    row: { dataHoraIso?: string; createdAt?: string },
    filtroData: string,
  ): boolean {
    const dateCandidates = [row.dataHoraIso, row.createdAt]
      .map((value) => String(value ?? '').trim())
      .filter((value) => value.length > 0);

    if (dateCandidates.length === 0) {
      return false;
    }

    const isoDate = this.normalizeDateToIso(filtroData);
    if (isoDate) {
      return dateCandidates.some((value) => value.startsWith(isoDate));
    }

    return dateCandidates.some((value) =>
      this.normalizeText(value).includes(filtroData),
    );
  }

  private normalizeDateToIso(input: string): string | null {
    const value = input.trim();

    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      return value;
    }

    const br = value.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (br) {
      const [, dd, mm, yyyy] = br;
      return `${yyyy}-${mm}-${dd}`;
    }

    return null;
  }

  private normalizeText(value: unknown): string {
    if (typeof value === 'string') {
      return value.trim().toLowerCase();
    }
    if (typeof value === 'number' || typeof value === 'boolean') {
      return String(value).trim().toLowerCase();
    }
    return '';
  }

  private toNullableString(value: unknown): string | null {
    if (value == null) return null;
    if (typeof value === 'string') {
      const trimmed = value.trim();
      return trimmed.length > 0 ? trimmed : null;
    }
    if (typeof value === 'number' || typeof value === 'boolean') {
      return String(value);
    }
    return null;
  }
}
