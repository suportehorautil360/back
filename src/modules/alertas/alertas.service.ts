import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ehComboioTipo } from '../../common/prisma/equipment-api.mapper';
import { resolverCompanyId } from '../../common/prisma/company-resolver';
import { PrismaService } from '../../prisma/prisma.service';
import { MailService } from '../mail/mail.service';

/** Dias de antecedência para alertar CNH a vencer (inclui já vencidas). */
const CNH_DIAS_ALERTA = 30;
/** Percentual do tanque considerado crítico. */
const TANQUE_CRITICO_PCT = 20;

export interface AlertaRevisao {
  descricao: string;
  identificacao: string;
  unidade: string;
  /** Medição da próxima revisão (ultimaRevisao + intervalo). */
  proxima: number;
  medicaoAtual: number;
  /** Quanto já passou do ponto de revisão. */
  excedente: number;
}

export interface AlertaCnh {
  nome: string;
  categoria: string;
  validade: string;
  /** Dias até vencer (negativo = vencida há N dias). */
  dias: number;
}

export interface AlertaTanque {
  nome: string;
  combustivel: string;
  percentual: number;
  volumeAtual: number;
  capacidade: number;
}

export interface AchadosAlertas {
  revisoes: AlertaRevisao[];
  cnhs: AlertaCnh[];
  tanques: AlertaTanque[];
}

export interface FlagsAlertas {
  revisao: boolean;
  cnh: boolean;
  tanque: boolean;
}

export interface ResumoVarredura {
  prefeiturasVarridas: number;
  prefeiturasComAchados: number;
  emailsEnviados: number;
  falhas: number;
  detalhes: {
    prefeituraId: string;
    total: number;
    enviado: boolean;
    motivo?: string;
  }[];
}

function texto(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

function numero(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

function formatDateBr(d: Date): string {
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const yyyy = d.getUTCFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

function resolveEmailAlertas(company: {
  email: string | null;
  contract: unknown;
}): string {
  const direto = texto(company.email).trim();
  if (direto) return direto;
  const contract =
    company.contract && typeof company.contract === 'object'
      ? (company.contract as { emailContratante?: string })
      : null;
  return texto(contract?.emailContratante).trim();
}

@Injectable()
export class AlertasService {
  private readonly logger = new Logger(AlertasService.name);

  constructor(
    private readonly prisma: PrismaService,
    private mail: MailService,
  ) {}

  /** Coleta os achados de alerta de uma prefeitura (respeitando as flags). */
  async coletar(
    prefeituraId: string,
    flags: FlagsAlertas,
  ): Promise<AchadosAlertas> {
    const companyId = await resolverCompanyId(this.prisma, prefeituraId);
    const out: AchadosAlertas = { revisoes: [], cnhs: [], tanques: [] };
    if (!companyId) return out;

    if (flags.revisao) {
      const equipamentos = await this.prisma.equipment.findMany({
        where: { companyId },
        select: {
          status: true,
          descricao: true,
          modelo: true,
          placa: true,
          chassi: true,
          medicaoAtual: true,
          ultimaRevisao: true,
          intervaloRevisao: true,
          unidadeRevisao: true,
        },
      });

      for (const eq of equipamentos) {
        if (texto(eq.status).toLowerCase() === 'inativo') continue;
        const medicao = numero(eq.medicaoAtual);
        const ultima = numero(eq.ultimaRevisao);
        const intervalo = numero(eq.intervaloRevisao);
        if (intervalo <= 0) continue;
        const usado = medicao - ultima;
        if (usado >= intervalo) {
          out.revisoes.push({
            descricao: texto(eq.descricao) || texto(eq.modelo) || 'Equipamento',
            identificacao: texto(eq.placa) || texto(eq.chassi) || '—',
            unidade: texto(eq.unidadeRevisao) || 'km',
            proxima: ultima + intervalo,
            medicaoAtual: medicao,
            excedente: usado - intervalo,
          });
        }
      }
    }

    if (flags.cnh) {
      const operadores = await this.prisma.operator.findMany({
        where: { companyId, cnhValidade: { not: null } },
        select: { nome: true, cnhCategoria: true, cnhValidade: true },
      });
      const hoje = new Date();
      for (const op of operadores) {
        if (!op.cnhValidade) continue;
        const validade = op.cnhValidade;
        const dias = Math.floor(
          (validade.getTime() - hoje.getTime()) / 86_400_000,
        );
        if (dias <= CNH_DIAS_ALERTA) {
          out.cnhs.push({
            nome: texto(op.nome) || 'Funcionário',
            categoria: texto(op.cnhCategoria),
            validade: formatDateBr(validade),
            dias,
          });
        }
      }
    }

    if (flags.tanque) {
      const comboios = await this.prisma.equipment.findMany({
        where: { companyId },
        select: {
          tipo: true,
          descricao: true,
          combustivel: true,
          capacidadeTanque: true,
          volumeTanqueAtual: true,
        },
      });

      for (const comboio of comboios) {
        if (!ehComboioTipo(comboio.tipo)) continue;
        const capacidade = numero(comboio.capacidadeTanque);
        const volume = numero(comboio.volumeTanqueAtual);
        if (capacidade <= 0) continue;
        const pct = (volume / capacidade) * 100;
        if (pct <= TANQUE_CRITICO_PCT) {
          out.tanques.push({
            nome: texto(comboio.descricao) || 'Comboio',
            combustivel: texto(comboio.combustivel),
            percentual: Math.round(pct),
            volumeAtual: volume,
            capacidade,
          });
        }
      }
    }

    return out;
  }

  /** Total de achados. */
  private total(a: AchadosAlertas): number {
    return a.revisoes.length + a.cnhs.length + a.tanques.length;
  }

  /**
   * Varre todas as empresas ativas no Postgres, coleta os alertas habilitados
   * e, havendo achados + email configurado, dispara o email.
   */
  async varrer(): Promise<ResumoVarredura> {
    const companies = await this.prisma.company.findMany({
      where: { status: 'ACTIVE' },
      include: { settings: true },
    });

    const resumo: ResumoVarredura = {
      prefeiturasVarridas: companies.length,
      prefeiturasComAchados: 0,
      emailsEnviados: 0,
      falhas: 0,
      detalhes: [],
    };

    for (const company of companies) {
      const prefeituraId = company.legacyId ?? company.id;
      const settings = company.settings;
      if (!settings) continue;

      const flags: FlagsAlertas = {
        revisao: settings.alertBloqueioRevisaoVencida,
        cnh: settings.alertCnhProximaVencimento,
        tanque: settings.alertNivelCriticoTanque,
      };
      if (!flags.revisao && !flags.cnh && !flags.tanque) continue;

      const achados = await this.coletar(prefeituraId, flags);
      const total = this.total(achados);
      if (total === 0) continue;
      resumo.prefeiturasComAchados++;

      const email = resolveEmailAlertas(company);
      if (!email) {
        resumo.detalhes.push({
          prefeituraId,
          total,
          enviado: false,
          motivo: 'sem emailAlertas configurado',
        });
        continue;
      }

      const r = await this.mail.enviar({
        to: email,
        subject: `Alertas operacionais — ${total} pendência(s) · Hora Útil 360`,
        html: this.montarHtml(
          texto(company.razaoSocial) || company.name || 'Sua operação',
          achados,
        ),
      });
      if (r.ok) {
        resumo.emailsEnviados++;
        resumo.detalhes.push({ prefeituraId, total, enviado: true });
      } else {
        resumo.falhas++;
        resumo.detalhes.push({
          prefeituraId,
          total,
          enviado: false,
          motivo: r.erro,
        });
      }
    }

    return resumo;
  }

  /** Cron diário às 07:00 (horário do servidor). */
  @Cron(CronExpression.EVERY_DAY_AT_7AM)
  async cronDiario(): Promise<void> {
    try {
      const resumo = await this.varrer();
      this.logger.log(
        `Varredura diária: ${resumo.prefeiturasVarridas} prefeituras, ` +
          `${resumo.prefeiturasComAchados} com achados, ` +
          `${resumo.emailsEnviados} emails enviados, ${resumo.falhas} falhas`,
      );
    } catch (err) {
      this.logger.error('Falha na varredura diária de alertas', err);
    }
  }

  private montarHtml(razaoSocial: string, achados: AchadosAlertas): string {
    const bloco = (titulo: string, linhas: string[]) =>
      linhas.length
        ? `<h3>${titulo}</h3><ul>${linhas.map((l) => `<li>${l}</li>`).join('')}</ul>`
        : '';

    const rev = achados.revisoes.map(
      (r) =>
        `${r.descricao} (${r.identificacao}) — ${r.excedente.toLocaleString('pt-BR')} ${r.unidade} além da revisão`,
    );
    const cnh = achados.cnhs.map(
      (c) =>
        `${c.nome} — CNH ${c.categoria} vence em ${c.dias} dia(s) (${c.validade})`,
    );
    const tan = achados.tanques.map(
      (t) =>
        `${t.nome} — ${t.percentual}% (${t.volumeAtual}/${t.capacidade} L, ${t.combustivel})`,
    );

    return `
      <p>Olá, <strong>${razaoSocial}</strong>.</p>
      <p>Resumo de alertas operacionais:</p>
      ${bloco('Revisões vencidas', rev)}
      ${bloco('CNH a vencer', cnh)}
      ${bloco('Tanques críticos', tan)}
      <p>— Hora Útil 360</p>
    `.trim();
  }
}
