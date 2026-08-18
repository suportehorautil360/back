import {
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Prisma } from '../../prisma/generated/client';
import { resolverCompanyId } from '../../common/prisma/company-resolver';
import { PrismaService } from '../../prisma/prisma.service';
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

export interface DadosEmergenciaWhats {
  prefeituraId: string;
  severity: string;
  chassis?: string | null;
  equipamentoId?: string | null;
  idMaquina?: string | null;
  tipoFalha: string;
  descricao: string;
  operadorNome?: string | null;
  localizacaoGps?: string | null;
  dataHoraIso: string;
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

function parseFotos(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((foto): foto is string => typeof foto === 'string');
}

function mapEmergencyRow(
  row: {
    id: string;
    legacyId: string | null;
    companyId: string;
    source: string;
    severity: string;
    equipmentLegacyId: string | null;
    idMaquina: string | null;
    chassi: string | null;
    operadorNome: string | null;
    tipoFalha: string;
    descricao: string;
    localizacaoGps: string | null;
    statusAtendimento: string;
    fotos: unknown;
    checklistLegacyId: string | null;
    questionId: string | null;
    questionLabel: string | null;
    dataHora: Date;
    createdAt: Date;
    updatedAt: Date;
  },
  prefeituraId: string,
): EmergencyDoc {
  const fotos = parseFotos(row.fotos);
  const equipamentoId = row.equipmentLegacyId ?? row.idMaquina;
  const dataHoraIso = row.dataHora.toISOString();
  return {
    id: row.legacyId ?? row.id,
    prefeituraId,
    source: row.source as EmergencySource,
    severity: row.severity as EmergencySeverity,
    equipamentoId,
    idMaquina: row.idMaquina ?? equipamentoId,
    chassis: row.chassi ?? '',
    operadorNome: row.operadorNome ?? '—',
    operador: row.operadorNome ?? '—',
    tipoFalha: row.tipoFalha,
    descricao: row.descricao,
    localizacaoGps: row.localizacaoGps,
    statusAtendimento: normalizeEmergencyStatus(row.statusAtendimento),
    fotos,
    qtdFotos: fotos.length,
    checklistRunId: row.checklistLegacyId,
    checklistId: row.checklistLegacyId,
    questionId: row.questionId,
    questionLabel: row.questionLabel,
    dataHoraIso,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

@Injectable()
export class EmergenciesService {
  private readonly logger = new Logger(EmergenciesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private whatsapp: WhatsAppService,
    private mail: MailService,
  ) {}

  async create(dto: CreateEmergencyDto) {
    const id = randomUUID();
    const agora = new Date();
    const fotos = Array.isArray(dto.fotos)
      ? dto.fotos.filter((foto) => typeof foto === 'string' && foto.length > 0)
      : [];
    const equipamentoId = dto.equipamentoId?.trim() || null;
    const companyId = await resolverCompanyId(this.prisma, dto.prefeituraId);
    if (!companyId) {
      throw new InternalServerErrorException('Empresa não encontrada.');
    }

    try {
      const row = await this.prisma.emergency.create({
        data: {
          id,
          legacyId: id,
          companyId,
          source: dto.source ?? 'manual',
          severity: dto.severity ?? 'critical',
          equipmentLegacyId: equipamentoId,
          idMaquina: equipamentoId,
          chassi: dto.chassis?.trim() || null,
          operadorNome: dto.operadorNome,
          tipoFalha: dto.tipoFalha,
          descricao: dto.descricao,
          localizacaoGps: dto.localizacaoGps?.trim() || null,
          statusAtendimento: 'ABERTO',
          fotos: fotos as Prisma.InputJsonValue,
          checklistLegacyId: dto.checklistRunId ?? null,
          questionId: dto.questionId ?? null,
          questionLabel: dto.questionLabel ?? null,
          dataHora: agora,
        },
      });

      const doc: EmergencyDoc = {
        ...mapEmergencyRow(row, dto.prefeituraId),
        answerValue: dto.answerValue,
      };

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

  async notificarWhatsApp(doc: DadosEmergenciaWhats): Promise<void> {
    try {
      if (!(await this.whatsapp.estaConectado())) {
        this.logger.warn(
          `WhatsApp desconectado — emergência ${doc.prefeituraId} não notificada por zap.`,
        );
        return;
      }

      const companyId = await resolverCompanyId(this.prisma, doc.prefeituraId);
      if (!companyId) return;

      const settings = await this.prisma.companySettings.findUnique({
        where: { companyId },
      });

      const ativo = settings?.alertWhatsappEmergencia === true;
      if (!ativo) {
        this.logger.warn(
          `Toggle alertWhatsappEmergencia desligado — prefeitura ${doc.prefeituraId}.`,
        );
        return;
      }

      const numerosEmpresa = await this.buscarNumerosWhatsappEmpresa(companyId);
      const numeroFrente = await this.buscarTelefoneFrenteDoEquipamento(
        doc.idMaquina ?? doc.equipamentoId,
      );
      const destinos = this.dedupNumeros([...numerosEmpresa, numeroFrente]);
      if (destinos.length === 0) {
        this.logger.warn(
          `Nenhum WhatsApp de destino — prefeitura ${doc.prefeituraId}.`,
        );
        return;
      }

      const texto = this.montarMensagem(doc);
      const fotos = (Array.isArray(doc.fotos) ? doc.fotos : []).filter(
        (foto): foto is string => typeof foto === 'string' && foto.length > 0,
      );

      for (const numero of destinos) {
        try {
          await this.enviarParaNumero(numero, texto, fotos);
        } catch (e) {
          this.logger.warn(
            `Falha ao notificar ${numero} por WhatsApp: ${(e as Error).message}`,
          );
        }
      }
    } catch (e) {
      this.logger.warn(
        `Falha ao notificar emergência por WhatsApp: ${(e as Error).message}`,
      );
    }
  }

  private async enviarParaNumero(
    numero: string,
    texto: string,
    fotos: string[],
  ): Promise<void> {
    if (fotos.length === 0) {
      await this.whatsapp.enviarMensagem(numero, texto);
      return;
    }
    for (let i = 0; i < fotos.length; i++) {
      await this.whatsapp.enviarImagem(
        numero,
        fotos[i],
        i === 0 ? texto : undefined,
      );
    }
  }

  private async buscarNumerosWhatsappEmpresa(companyId: string): Promise<string[]> {
    const recipients = await this.prisma.companyWhatsappRecipient.findMany({
      where: { companyId, ativo: true },
      orderBy: { sortOrder: 'asc' },
      select: { telefone: true },
    });
    const numeros = recipients
      .map((r) => r.telefone.trim())
      .filter((n) => n.length > 0);
    if (numeros.length > 0) return numeros;

    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: { whatsapp: true },
    });
    const legado = (company?.whatsapp ?? '').trim();
    return legado ? [legado] : [];
  }

  private async buscarTelefoneFrenteDoEquipamento(
    equipId?: string | null,
  ): Promise<string> {
    const frente = await this.buscarFrenteDoEquipamento(equipId);
    return frente?.telefone?.trim() ?? '';
  }

  private async buscarEmailFrenteDoEquipamento(
    equipId?: string | null,
  ): Promise<string> {
    const frente = await this.buscarFrenteDoEquipamento(equipId);
    return frente?.email?.trim() ?? '';
  }

  private async buscarFrenteDoEquipamento(equipId?: string | null) {
    const id = (equipId ?? '').trim();
    if (!id) return null;

    const equipment = await this.prisma.equipment.findFirst({
      where: { OR: [{ legacyId: id }, { id }] },
      select: { id: true },
    });
    if (!equipment) return null;

    const alocacao = await this.prisma.workFrontAllocation.findFirst({
      where: { equipmentId: equipment.id, endDate: null },
      include: { workFront: { select: { telefone: true, email: true } } },
      orderBy: { startDate: 'desc' },
    });
    return alocacao?.workFront ?? null;
  }

  private async buscarEmailEmpresa(prefeituraId: string): Promise<string> {
    const companyId = await resolverCompanyId(this.prisma, prefeituraId);
    if (!companyId) return '';
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: { email: true, contract: true },
    });
    if (!company) return '';
    const direto = (company.email ?? '').trim();
    if (direto) return direto;
    const contract =
      company.contract && typeof company.contract === 'object'
        ? (company.contract as { emailContratante?: string })
        : null;
    return (contract?.emailContratante ?? '').trim();
  }

  async notificarEmail(doc: DadosEmergenciaWhats): Promise<void> {
    try {
      if (!this.mail.habilitado()) return;
      const emailEmpresa = await this.buscarEmailEmpresa(doc.prefeituraId);
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

  async listByPrefeitura(prefeituraId: string, filters?: EmergencyFilters) {
    try {
      const companyId = await resolverCompanyId(this.prisma, prefeituraId);
      if (!companyId) {
        return { data: [] as EmergencyDoc[], message: 'Emergências carregadas.' };
      }

      const rows = await this.prisma.emergency.findMany({
        where: { companyId },
        orderBy: { dataHora: 'desc' },
      });
      const data = rows
        .map((row) => mapEmergencyRow(row, prefeituraId))
        .filter((row) => this.matchesFilters(row, filters));
      return { data, message: 'Emergências carregadas.' };
    } catch (error) {
      console.error('Erro ao listar emergências:', error);
      throw new InternalServerErrorException(
        'Não foi possível listar as emergências.',
      );
    }
  }

  async updateStatus(id: string, status: string) {
    const normalized = normalizeEmergencyStatus(status);
    const row = await this.prisma.emergency.findFirst({
      where: { OR: [{ id }, { legacyId: id }] },
    });
    if (!row) {
      throw new NotFoundException('Emergência não encontrada.');
    }
    await this.prisma.emergency.update({
      where: { id: row.id },
      data: { statusAtendimento: normalized },
    });
    return {
      data: { id: row.legacyId ?? row.id, statusAtendimento: normalized },
      message: 'Status da emergência atualizado.',
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
}
