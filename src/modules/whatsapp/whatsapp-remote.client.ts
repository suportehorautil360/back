import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { WhatsappOverview, WhatsAppStatus } from './whatsapp-metrics';

type RemoteEnvelope<T> = {
  data?: T;
  message?: string | string[];
};

export type WhatsAppStatusResp = {
  status: WhatsAppStatus;
  qrImagem?: string;
};

/**
 * Cliente HTTP para um serviço WhatsApp externo (ex.: outro deploy no Railway
 * com Baileys). Ativo quando `WHATSAPP_SERVICE_URL` está definido.
 */
@Injectable()
export class WhatsAppRemoteClient {
  private readonly logger = new Logger(WhatsAppRemoteClient.name);

  constructor(private readonly config: ConfigService) {}

  isEnabled(): boolean {
    return !!this.baseUrl();
  }

  private baseUrl(): string {
    return (this.config.get<string>('WHATSAPP_SERVICE_URL') ?? '').trim().replace(/\/$/, '');
  }

  private secret(): string | undefined {
    const dedicated = this.config.get<string>('WHATSAPP_SERVICE_SECRET')?.trim();
    if (dedicated) return dedicated;
    return this.config.get<string>('ADMIN_SECRET')?.trim() || undefined;
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const base = this.baseUrl();
    if (!base) {
      throw new Error('WHATSAPP_SERVICE_URL não configurado.');
    }

    const headers: Record<string, string> = {};
    const secret = this.secret();
    if (secret) {
      headers['x-admin-secret'] = secret;
    }
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }

    const url = `${base}${path.startsWith('/') ? path : `/${path}`}`;
    let response: Response;
    try {
      response = await fetch(url, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    } catch (error) {
      this.logger.warn(
        `Falha de rede ao chamar serviço WhatsApp (${method} ${path}): ${(error as Error).message}`,
      );
      throw new Error('Serviço WhatsApp indisponível.');
    }

    const json = (await response.json().catch(() => null)) as
      | RemoteEnvelope<T>
      | { message?: string | string[] }
      | null;

    if (!response.ok) {
      const message =
        json && 'message' in json && json.message
          ? Array.isArray(json.message)
            ? json.message.join(', ')
            : json.message
          : `Erro ${response.status} no serviço WhatsApp.`;
      throw new Error(message);
    }

    if (!json || !('data' in json) || json.data === undefined) {
      throw new Error('Resposta inválida do serviço WhatsApp.');
    }

    return json.data;
  }

  async getStatus(): Promise<WhatsAppStatusResp> {
    return this.request<WhatsAppStatusResp>('GET', '/status');
  }

  async connect(): Promise<WhatsAppStatusResp> {
    await this.request<WhatsAppStatusResp>('POST', '/connect');
    return this.getStatus();
  }

  async logout(): Promise<void> {
    await this.request<Record<string, never>>('POST', '/logout');
  }

  async enviarTeste(numero: string): Promise<void> {
    await this.request<Record<string, never>>('POST', '/enviar-teste', { numero });
  }

  async getOverview(): Promise<WhatsappOverview> {
    return this.request<WhatsappOverview>('GET', '/overview');
  }

  async enviarMensagem(numero: string, texto: string): Promise<void> {
    await this.request<Record<string, never>>('POST', '/enviar-mensagem', {
      numero,
      texto,
    });
  }

  async enviarImagem(
    numero: string,
    imagem: string,
    legenda?: string,
  ): Promise<void> {
    await this.request<Record<string, never>>('POST', '/enviar-imagem', {
      numero,
      imagem,
      legenda,
    });
  }

  async estaConectado(): Promise<boolean> {
    try {
      const status = await this.getStatus();
      return status.status === 'conectado';
    } catch {
      return false;
    }
  }
}
