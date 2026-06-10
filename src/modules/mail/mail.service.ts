import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';

export interface EnviarEmailInput {
  /** Destinatário(s). */
  to: string | string[];
  subject: string;
  /** Corpo em HTML (obrigatório). */
  html: string;
  /** Versão texto puro (opcional, recomendado para deliverability). */
  text?: string;
  /** Responder-para (opcional). */
  replyTo?: string;
}

export interface EnviarEmailResult {
  ok: boolean;
  id?: string;
  erro?: string;
}

/**
 * Envio de email via Resend. A chave fica em `RESEND_API_KEY` (env) e o
 * remetente em `MAIL_FROM` (default: sandbox do Resend). Sem chave, o serviço
 * vira no-op — nunca lança, para não quebrar fluxos que disparam email.
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly resend: Resend | null;
  private readonly from: string;

  constructor(private config: ConfigService) {
    const apiKey = this.config.get<string>('RESEND_API_KEY');
    this.from =
      this.config.get<string>('MAIL_FROM') ??
      'Hora Útil 360 <onboarding@resend.dev>';
    this.resend = apiKey ? new Resend(apiKey) : null;
    if (!this.resend) {
      this.logger.warn(
        'RESEND_API_KEY ausente — envio de email desativado (no-op).',
      );
    }
  }

  /** Email habilitado? (chave configurada) */
  habilitado(): boolean {
    return this.resend !== null;
  }

  /** Remetente configurado (para exibir no status). */
  remetente(): string {
    return this.from;
  }

  /**
   * Envia um email. Best-effort: nunca lança — devolve `{ ok, id?, erro? }`
   * para o chamador decidir o que fazer.
   */
  async enviar(input: EnviarEmailInput): Promise<EnviarEmailResult> {
    if (!this.resend) {
      return {
        ok: false,
        erro: 'Serviço de email não configurado (RESEND_API_KEY ausente).',
      };
    }
    try {
      const { data, error } = await this.resend.emails.send({
        from: this.from,
        to: input.to,
        subject: input.subject,
        html: input.html,
        ...(input.text ? { text: input.text } : {}),
        ...(input.replyTo ? { replyTo: input.replyTo } : {}),
      });
      if (error) {
        this.logger.warn(`Falha ao enviar email: ${error.message}`);
        return { ok: false, erro: error.message };
      }
      return { ok: true, id: data?.id };
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Erro desconhecido.';
      this.logger.error(`Erro ao enviar email: ${msg}`);
      return { ok: false, erro: msg };
    }
  }
}
