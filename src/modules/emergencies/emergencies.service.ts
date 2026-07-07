import {
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { FirebaseService } from '../../config/firebase.service';
import { WhatsAppService } from '../whatsapp/whatsapp.service';
import { formatarJid } from '../whatsapp/phone';
import { MailService } from '../mail/mail.service';
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

/** Dados mínimos de uma emergência para montar/disparar a notificação. */
export interface DadosEmergenciaWhats {
  prefeituraId: string;
  severity: string;
  chassis?: string | null;
  /** Id do equipamento — usado para achar a frente alocada e notificá-la. */
  equipamentoId?: string | null;
  idMaquina?: string | null;
  tipoFalha: string;
  descricao: string;
  operadorNome?: string | null;
  localizacaoGps?: string | null;
  dataHoraIso: string;
  /** Fotos anexadas (data URL/base64). Enviadas como imagem no WhatsApp. */
  fotos?: string[] | null;
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
  private readonly logger = new Logger(EmergenciesService.name);

  constructor(
    private firebase: FirebaseService,
    private whatsapp: WhatsAppService,
    private mail: MailService,
  ) {}

  private get collection() {
    return this.firebase.getFirestore().collection('emergenciasRegistros');
  }

  async create(dto: CreateEmergencyDto) {
    const id = randomUUID();
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
      // Aguarda antes de responder: em serverless (Vercel) tarefas em
      // background com `void` são cortadas quando a resposta HTTP termina.
      await Promise.all([
        this.notificarWhatsApp(doc),
        this.notificarEmail(doc),
      ]);
      return { data: doc, message: 'Emergência registrada com sucesso.' };
    } catch (error) {
      console.error('Erro ao registrar emergência:', error);
      throw new InternalServerErrorException(
        'Não foi possível registrar a emergência.',
      );
    }
  }

  /** Texto da mensagem de WhatsApp para uma emergência. */
  private montarMensagem(doc: DadosEmergenciaWhats): string {
    const sev: Record<string, string> = {
      critical: 'Crítica',
      high: 'Alta',
      medium: 'Média',
      low: 'Baixa',
    };
    const dataBr = new Date(doc.dataHoraIso).toLocaleString('pt-BR', {
      timeZone: 'America/Sao_Paulo',
    });
    return [
      '🚨 *Emergência registrada — Hora Útil 360*',
      `Severidade: ${sev[doc.severity] ?? doc.severity}`,
      `Equipamento: ${doc.chassis || doc.idMaquina || '—'}`,
      `Falha: ${doc.tipoFalha}`,
      doc.descricao ? `Descrição: ${doc.descricao}` : '',
      doc.operadorNome ? `Operador: ${doc.operadorNome}` : '',
      doc.localizacaoGps ? `Local: ${doc.localizacaoGps}` : '',
      `Data: ${dataBr}`,
    ]
      .filter(Boolean)
      .join('\n');
  }

  /**
   * Dispara a notificação de WhatsApp se: o WhatsApp está conectado, a empresa
   * ativou o toggle e cadastrou um número. Nunca lança (best-effort). Público
   * porque a emergência do checklist é gravada direto no Firestore pelo front
   * (não passa por `create`), então o front chama esta notificação à parte.
   */
  async notificarWhatsApp(doc: DadosEmergenciaWhats): Promise<void> {
    try {
      if (!(await this.whatsapp.estaConectado())) {
        this.logger.warn(
          `WhatsApp desconectado — emergência ${doc.prefeituraId} não notificada por zap.`,
        );
        return;
      }
      const snap = await this.firebase
        .getFirestore()
        .collection('configuracoes')
        .where('prefeituraId', '==', doc.prefeituraId)
        .get();
      const cfg = snap.docs[0]?.data() as
        | {
            empresa?: { whatsappNumero?: string };
            alertas?: { notificacaoWhatsapp?: boolean };
          }
        | undefined;
      // O toggle global gateia tudo: desligado → ninguém é notificado.
      const ativo = cfg?.alertas?.notificacaoWhatsapp === true;
      if (!ativo) {
        this.logger.warn(
          `Toggle notificacaoWhatsapp desligado — prefeitura ${doc.prefeituraId}.`,
        );
        return;
      }

      // Destinatários: número da empresa + telefone da frente onde o
      // equipamento está alocado. Deduplicados pelo JID — o mesmo número
      // escrito de formas diferentes não recebe duas vezes.
      const numeroEmpresa = (cfg?.empresa?.whatsappNumero ?? '').trim();
      const numeroFrente = await this.buscarTelefoneFrenteDoEquipamento(
        doc.idMaquina ?? doc.equipamentoId,
      );
      const destinos = this.dedupNumeros([numeroEmpresa, numeroFrente]);
      if (destinos.length === 0) {
        this.logger.warn(
          `Nenhum WhatsApp de destino — prefeitura ${doc.prefeituraId} ` +
            `(empresa="${numeroEmpresa || '—'}", frente="${numeroFrente || '—'}").`,
        );
        return;
      }

      const texto = this.montarMensagem(doc);
      const fotos = (Array.isArray(doc.fotos) ? doc.fotos : []).filter(
        (foto): foto is string => typeof foto === 'string' && foto.length > 0,
      );

      this.logger.log(
        `Notificando emergência por WhatsApp — prefeitura=${doc.prefeituraId}, ` +
          `destinos=[${destinos.join(', ')}], fotos=${fotos.length}, ` +
          `tipoFalha="${doc.tipoFalha}".`,
      );

      // Cada destino é independente: falhar num número não impede o outro.
      for (const numero of destinos) {
        try {
          await this.enviarParaNumero(numero, texto, fotos);
        } catch (e) {
          this.logger.warn(
            `Falha ao notificar ${numero} por WhatsApp (prefeitura=${doc.prefeituraId}, ` +
              `fotos=${fotos.length}): ${(e as Error).message}`,
          );
        }
      }
    } catch (e) {
      this.logger.warn(
        `Falha ao notificar emergência por WhatsApp (prefeitura=${doc.prefeituraId}): ` +
          `${(e as Error).message}`,
      );
    }
  }

  /** Envia o texto da emergência (com fotos como imagem, se houver) a um número. */
  private async enviarParaNumero(
    numero: string,
    texto: string,
    fotos: string[],
  ): Promise<void> {
    if (fotos.length === 0) {
      this.logger.debug(`WhatsApp sendText → ${numero}`);
      await this.whatsapp.enviarMensagem(numero, texto);
      return;
    }
    // A 1ª foto leva o texto como legenda; as demais vão soltas — assim a
    // emergência chega como uma única notificação com imagem + detalhes.
    for (let i = 0; i < fotos.length; i++) {
      const foto = fotos[i];
      this.logger.debug(
        `WhatsApp sendMedia → ${numero} (foto ${i + 1}/${fotos.length}, ` +
          `${foto.length} chars)`,
      );
      await this.whatsapp.enviarImagem(
        numero,
        foto,
        i === 0 ? texto : undefined,
      );
    }
  }

  /**
   * Telefone (WhatsApp) da frente de trabalho onde o equipamento está alocado.
   * Caminho: equipamento.id → allocations.vehicleId → allocations.workFrontId →
   * work-fronts.telefone. Retorna `''` quando não há alocação/telefone.
   */
  private async buscarTelefoneFrenteDoEquipamento(
    equipId?: string | null,
  ): Promise<string> {
    const id = (equipId ?? '').trim();
    if (!id) return '';
    const db = this.firebase.getFirestore();
    const alocacoes = await db
      .collection('allocations')
      .where('vehicleId', '==', id)
      .get();
    // allocate() garante no máximo 1 alocação por equipamento.
    const workFrontId = alocacoes.docs[0]?.data()?.workFrontId as
      | string
      | undefined;
    if (!workFrontId) return '';
    const frentes = await db
      .collection('work-fronts')
      .where('id', '==', workFrontId)
      .get();
    const telefone = frentes.docs[0]?.data()?.telefone as string | undefined;
    return typeof telefone === 'string' ? telefone.trim() : '';
  }

  /**
   * Notifica a emergência por EMAIL: email da frente alocada + `emailAlertas`
   * da empresa (deduplicados). Best-effort, nunca lança. Pública porque a
   * emergência do checklist é gravada direto pelo front e chama esta à parte.
   */
  async notificarEmail(doc: DadosEmergenciaWhats): Promise<void> {
    try {
      if (!this.mail.habilitado()) return;
      const snap = await this.firebase
        .getFirestore()
        .collection('configuracoes')
        .where('prefeituraId', '==', doc.prefeituraId)
        .get();
      const cfg = snap.docs[0]?.data() as
        | { empresa?: { emailAlertas?: string } }
        | undefined;
      const emailEmpresa = (cfg?.empresa?.emailAlertas ?? '').trim();
      const emailFrente = await this.buscarEmailFrenteDoEquipamento(
        doc.idMaquina ?? doc.equipamentoId,
      );
      const destinos = this.dedupEmails([emailEmpresa, emailFrente]);
      if (destinos.length === 0) return;

      const r = await this.mail.enviar({
        to: destinos,
        subject: `🚨 Emergência — ${doc.tipoFalha} · Hora Útil 360`,
        html: this.montarEmailHtml(doc),
      });
      if (!r.ok) {
        console.warn('Falha ao enviar email de emergência:', r.erro);
      }
    } catch (e) {
      console.warn(
        'Falha ao notificar emergência por email:',
        (e as Error).message,
      );
    }
  }

  /**
   * Email da frente de trabalho onde o equipamento está alocado.
   * Caminho: equipamento.id → allocations.vehicleId → allocations.workFrontId →
   * work-fronts.email. Retorna `''` quando não há alocação/email.
   */
  private async buscarEmailFrenteDoEquipamento(
    equipId?: string | null,
  ): Promise<string> {
    const id = (equipId ?? '').trim();
    if (!id) return '';
    const db = this.firebase.getFirestore();
    const alocacoes = await db
      .collection('allocations')
      .where('vehicleId', '==', id)
      .get();
    const workFrontId = alocacoes.docs[0]?.data()?.workFrontId as
      | string
      | undefined;
    if (!workFrontId) return '';
    const frentes = await db
      .collection('work-fronts')
      .where('id', '==', workFrontId)
      .get();
    const email = frentes.docs[0]?.data()?.email as string | undefined;
    return typeof email === 'string' ? email.trim() : '';
  }

  /** Remove emails vazios/duplicados (case-insensitive), preservando a ordem. */
  private dedupEmails(emails: string[]): string[] {
    const vistos = new Set<string>();
    const out: string[] = [];
    for (const e of emails) {
      const v = e.trim().toLowerCase();
      if (!v || vistos.has(v)) continue;
      vistos.add(v);
      out.push(e.trim());
    }
    return out;
  }

  /** HTML do email de emergência. */
  private montarEmailHtml(doc: DadosEmergenciaWhats): string {
    const sev: Record<string, string> = {
      critical: 'Crítica',
      high: 'Alta',
      medium: 'Média',
      low: 'Baixa',
    };
    const severidade =
      sev[String(doc.severity).toLowerCase()] ?? String(doc.severity);
    const quando = new Date(doc.dataHoraIso).toLocaleString('pt-BR', {
      timeZone: 'America/Sao_Paulo',
    });
    const linha = (rotulo: string, valor?: string | null) =>
      valor
        ? `<p style="margin:4px 0"><strong>${rotulo}:</strong> ${valor}</p>`
        : '';
    const local = doc.localizacaoGps
      ? `<p style="margin:4px 0"><strong>Local:</strong> <a href="https://maps.google.com/?q=${encodeURIComponent(
          doc.localizacaoGps,
        )}">${doc.localizacaoGps}</a></p>`
      : '';
    return `
      <div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#1f2937">
        <h2 style="margin:0 0 4px;color:#b91c1c">🚨 Emergência registrada</h2>
        <p style="margin:0 0 16px;color:#6b7280">Hora Útil 360 · severidade ${severidade}</p>
        ${linha('Tipo de falha', doc.tipoFalha)}
        ${linha('Descrição', doc.descricao)}
        ${linha('Equipamento', doc.chassis)}
        ${linha('Operador', doc.operadorNome)}
        ${linha('Quando', quando)}
        ${local}
        <hr style="border:none;border-top:1px solid #e5e7eb;margin:20px 0" />
        <p style="font-size:12px;color:#9ca3af;margin:0">
          Notificação automática de emergência da plataforma.
        </p>
      </div>`;
  }

  /** Remove vazios e duplicatas (comparando pelo JID normalizado). */
  private dedupNumeros(numeros: string[]): string[] {
    const vistos = new Set<string>();
    const saida: string[] = [];
    for (const numero of numeros) {
      const limpo = numero.trim();
      if (!limpo) continue;
      const chave = formatarJid(limpo);
      if (vistos.has(chave)) continue;
      vistos.add(chave);
      saida.push(limpo);
    }
    return saida;
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
      localizacaoGps: localizacaoGps,
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
