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

  async listByPrefeitura(prefeituraId: string) {
    try {
      const snap = await this.collection
        .where('prefeituraId', '==', prefeituraId)
        .get();
      const rows = snap.docs
        .map((doc) => this.mapFirestoreDoc(doc.id, doc.data()))
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
    // GPS pode vir como string ou objeto de coordenadas — preserva o valor
    // como veio, só tipando como unknown para não propagar `any`.
    const localizacaoGps: unknown =
      data.localizacaoGps ?? data.Localizacao_GPS ?? null;
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
      localizacaoGps,
      fotos,
      qtdFotos: Number(
        data.qtdFotos ?? data.Qtd_Fotos_Evidencia ?? fotos.length,
      ),
      statusAtendimento,
      dataHoraIso: String(data.dataHoraIso ?? data.Data_Hora ?? ''),
    };
  }
}
