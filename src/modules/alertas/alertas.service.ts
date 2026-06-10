import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { FirebaseService } from '../../config/firebase.service';
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

function rec(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
}
function texto(v: unknown): string {
  return typeof v === 'string' ? v : '';
}
function numero(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

/** Aceita "YYYY-MM-DD" ou "DD/MM/YYYY"; senão tenta o parser nativo. */
function parseData(s: string): Date | null {
  const t = s.trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(t);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12);
  m = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(t);
  if (m) return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]), 12);
  const d = new Date(t);
  return Number.isNaN(d.getTime()) ? null : d;
}

@Injectable()
export class AlertasService {
  private readonly logger = new Logger(AlertasService.name);

  constructor(
    private firebase: FirebaseService,
    private mail: MailService,
  ) {}

  /** Coleta os achados de alerta de uma prefeitura (respeitando as flags). */
  async coletar(
    prefeituraId: string,
    flags: FlagsAlertas,
  ): Promise<AchadosAlertas> {
    const db = this.firebase.getFirestore();
    const out: AchadosAlertas = { revisoes: [], cnhs: [], tanques: [] };

    if (flags.revisao) {
      const snap = await db
        .collection('equipamentos')
        .where('prefeituraId', '==', prefeituraId)
        .get();
      for (const doc of snap.docs) {
        const d = rec(doc.data());
        if (texto(d.status) === 'inativo') continue;
        const medicao = numero(d.medicaoAtual);
        const ultima = numero(d.ultimaRevisao);
        const intervalo = numero(d.intervaloRevisao);
        if (intervalo <= 0) continue;
        const usado = medicao - ultima;
        if (usado >= intervalo) {
          out.revisoes.push({
            descricao: texto(d.descricao) || texto(d.modelo) || 'Equipamento',
            identificacao: texto(d.placa) || texto(d.chassis) || '—',
            unidade: texto(d.unidadeRevisao) || 'km',
            proxima: ultima + intervalo,
            medicaoAtual: medicao,
            excedente: usado - intervalo,
          });
        }
      }
    }

    if (flags.cnh) {
      const snap = await db
        .collection('operadores')
        .where('prefeituraId', '==', prefeituraId)
        .get();
      const hoje = new Date();
      for (const doc of snap.docs) {
        const d = rec(doc.data());
        const validadeStr = texto(d.cnhValidade).trim();
        if (!validadeStr) continue;
        const validade = parseData(validadeStr);
        if (!validade) continue;
        const dias = Math.floor(
          (validade.getTime() - hoje.getTime()) / 86_400_000,
        );
        if (dias <= CNH_DIAS_ALERTA) {
          out.cnhs.push({
            nome: texto(d.nome) || 'Funcionário',
            categoria: texto(d.cnhCategoria),
            validade: validadeStr,
            dias,
          });
        }
      }
    }

    if (flags.tanque) {
      const snap = await db
        .collection('tanks')
        .where('prefeituraId', '==', prefeituraId)
        .get();
      for (const doc of snap.docs) {
        const d = rec(doc.data());
        const capacidade = numero(d.capacity);
        const volume = numero(d.currentVolume);
        if (capacidade <= 0) continue;
        const pct = (volume / capacidade) * 100;
        if (pct <= TANQUE_CRITICO_PCT) {
          out.tanques.push({
            nome: texto(d.name) || 'Tanque',
            combustivel: texto(d.fuelType),
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
   * Varre todas as prefeituras (driver: coleção `configuracoes`), coleta os
   * alertas habilitados e, havendo achados + email configurado, dispara o email.
   */
  async varrer(): Promise<ResumoVarredura> {
    const db = this.firebase.getFirestore();
    const snap = await db.collection('configuracoes').get();
    const resumo: ResumoVarredura = {
      prefeiturasVarridas: snap.size,
      prefeiturasComAchados: 0,
      emailsEnviados: 0,
      falhas: 0,
      detalhes: [],
    };

    for (const doc of snap.docs) {
      const cfg = rec(doc.data());
      const prefeituraId = texto(cfg.prefeituraId);
      if (!prefeituraId) continue;

      const flagsCfg = rec(cfg.alertas);
      const flags: FlagsAlertas = {
        revisao: flagsCfg.bloqueioRevisaoVencida !== false,
        cnh: flagsCfg.cnhProximaVencimento !== false,
        tanque: flagsCfg.nivelCriticoTanque !== false,
      };
      if (!flags.revisao && !flags.cnh && !flags.tanque) continue;

      const achados = await this.coletar(prefeituraId, flags);
      const total = this.total(achados);
      if (total === 0) continue;
      resumo.prefeiturasComAchados++;

      const empresa = rec(cfg.empresa);
      const email = texto(empresa.emailAlertas).trim();
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
          texto(empresa.razaoSocial) || 'Sua operação',
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

  /** Cron diário às 07:00 (America/Sao_Paulo). */
  @Cron(CronExpression.EVERY_DAY_AT_7AM, { timeZone: 'America/Sao_Paulo' })
  async rodarDiario(): Promise<void> {
    if (!this.mail.habilitado()) return;
    this.logger.log('Varredura diária de alertas operacionais…');
    try {
      const r = await this.varrer();
      this.logger.log(
        `Alertas: ${r.emailsEnviados} email(s) enviado(s) em ${r.prefeiturasComAchados} prefeitura(s).`,
      );
    } catch (e) {
      this.logger.error(
        `Falha na varredura de alertas: ${(e as Error).message}`,
      );
    }
  }

  /** Monta o HTML do email de alertas. */
  private montarHtml(empresa: string, a: AchadosAlertas): string {
    const secoes: string[] = [];

    if (a.revisoes.length) {
      const linhas = a.revisoes
        .map(
          (r) =>
            `<li><strong>${r.descricao}</strong> (${r.identificacao}) — vencida há <strong>${r.excedente.toLocaleString('pt-BR')} ${r.unidade}</strong> (atual ${r.medicaoAtual.toLocaleString('pt-BR')} ${r.unidade}, revisão prevista em ${r.proxima.toLocaleString('pt-BR')} ${r.unidade}).</li>`,
        )
        .join('');
      secoes.push(
        `<h3 style="margin:18px 0 6px;color:#b91c1c">🔧 Revisões vencidas (${a.revisoes.length})</h3><ul style="margin:0;padding-left:18px">${linhas}</ul>`,
      );
    }

    if (a.cnhs.length) {
      const linhas = a.cnhs
        .map((c) => {
          const sit =
            c.dias < 0
              ? `vencida há ${Math.abs(c.dias)} dia(s)`
              : c.dias === 0
                ? 'vence hoje'
                : `vence em ${c.dias} dia(s)`;
          const cat = c.categoria ? ` · cat. ${c.categoria}` : '';
          return `<li><strong>${c.nome}</strong>${cat} — CNH ${sit} (validade ${c.validade}).</li>`;
        })
        .join('');
      secoes.push(
        `<h3 style="margin:18px 0 6px;color:#b45309">🪪 CNH a vencer (${a.cnhs.length})</h3><ul style="margin:0;padding-left:18px">${linhas}</ul>`,
      );
    }

    if (a.tanques.length) {
      const linhas = a.tanques
        .map(
          (t) =>
            `<li><strong>${t.nome}</strong>${t.combustivel ? ` (${t.combustivel})` : ''} — <strong>${t.percentual}%</strong> (${t.volumeAtual.toLocaleString('pt-BR')} / ${t.capacidade.toLocaleString('pt-BR')} L).</li>`,
        )
        .join('');
      secoes.push(
        `<h3 style="margin:18px 0 6px;color:#b91c1c">⛽ Tanques em nível crítico (${a.tanques.length})</h3><ul style="margin:0;padding-left:18px">${linhas}</ul>`,
      );
    }

    return `
      <div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#1f2937">
        <h2 style="margin:0 0 4px;color:#0f2348">Hora Útil 360</h2>
        <p style="margin:0 0 16px;color:#6b7280">Alertas operacionais · ${empresa}</p>
        ${secoes.join('')}
        <hr style="border:none;border-top:1px solid #e5e7eb;margin:20px 0" />
        <p style="font-size:12px;color:#9ca3af;margin:0">
          Email automático da varredura diária. Ajuste quais alertas receber em
          Configurações → Alertas.
        </p>
      </div>`;
  }
}
