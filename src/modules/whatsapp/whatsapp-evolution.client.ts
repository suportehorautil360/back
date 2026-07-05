import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { formatarNumeroEvolution } from './phone';
import { WhatsAppMetricsService } from './whatsapp-metrics.service';
import {
  calcularDisponibilidade,
  montarOverview,
  type WhatsappOverview,
  type WhatsAppStatus,
} from './whatsapp-metrics';
import type { WhatsAppStatusResp } from './whatsapp-remote.client';

type EvolutionConnectionState = 'open' | 'close' | 'connecting' | string;

type EvolutionConnectionResponse = {
  instance?: {
    instanceName?: string;
    state?: EvolutionConnectionState;
  };
  connectionStatus?: EvolutionConnectionState;
};

type EvolutionConnectResponse = {
  base64?: string;
  code?: string;
  pairingCode?: string;
  count?: number;
};

type EvolutionInstanceRecord = {
  instance?: {
    instanceName?: string;
    owner?: string;
    profileName?: string;
    status?: string;
  };
  name?: string;
  connectionStatus?: EvolutionConnectionState;
  owner?: string;
  profileName?: string;
};

@Injectable()
export class WhatsAppEvolutionClient {
  private readonly logger = new Logger(WhatsAppEvolutionClient.name);
  private cachedInstanceName: string | null = null;

  constructor(
    private readonly config: ConfigService,
    private readonly metrics: WhatsAppMetricsService,
  ) {}

  isEnabled(): boolean {
    return !!this.baseUrl() && !!this.apiKey();
  }

  private baseUrl(): string {
    let url = (
      this.config.get<string>('EVOLUTION_BASE_URL') ??
      this.config.get<string>('EVOLUTION_API_URL') ??
      ''
    ).trim();

    if (url && !/^https?:\/\//i.test(url)) {
      url = `https://${url}`;
    }

    return url.replace(/\/$/, '');
  }

  private apiKey(): string {
    return (
      this.config.get<string>('EVOLUTION_AUTH_KEY') ??
      this.config.get<string>('EVOLUTION_API_KEY') ??
      this.config.get<string>('AUTHENTICATION_API_KEY') ??
      ''
    ).trim();
  }

  private configuredInstance(): string {
    return (
      this.config.get<string>('EVOLUTION_INSTANCE') ??
      this.config.get<string>('EVOLUTION_INSTANCE_NAME') ??
      ''
    ).trim();
  }

  private async resolveInstanceName(): Promise<string> {
    const configured = this.configuredInstance();
    if (configured) {
      this.cachedInstanceName = configured;
      return configured;
    }

    if (this.cachedInstanceName) {
      return this.cachedInstanceName;
    }

    const instances = await this.fetchInstances();
    const connected =
      instances.find(
        (item) =>
          this.readConnectionState(item) === 'open' ||
          item.instance?.status === 'open',
      ) ?? instances[0];

    const name =
      connected?.instance?.instanceName?.trim() ||
      connected?.name?.trim() ||
      '';

    if (!name) {
      throw new Error(
        'Defina EVOLUTION_INSTANCE com o nome da instance criada no Manager.',
      );
    }

    this.cachedInstanceName = name;
    return name;
  }

  private readConnectionState(item: EvolutionInstanceRecord): string {
    return (
      item.connectionStatus ??
      item.instance?.status ??
      ''
    )
      .trim()
      .toLowerCase();
  }

  private mapEvolutionState(state: string | undefined): WhatsAppStatus {
    const normalized = (state ?? '').trim().toLowerCase();

    if (normalized === 'open') return 'conectado';
    if (normalized === 'connecting') return 'conectando';
    if (normalized === 'close' || normalized === 'closed') return 'desconectado';
    return 'desconectado';
  }

  private normalizeQr(base64?: string): string | undefined {
    const raw = base64?.trim();
    if (!raw) return undefined;
    if (raw.startsWith('data:image')) return raw;
    return `data:image/png;base64,${raw}`;
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const base = this.baseUrl();
    const apikey = this.apiKey();

    if (!base || !apikey) {
      throw new Error('Evolution API não configurada (URL ou AUTH KEY).');
    }

    const url = `${base}${path.startsWith('/') ? path : `/${path}`}`;
    let response: Response;

    try {
      response = await fetch(url, {
        method,
        headers: {
          apikey,
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    } catch (error) {
      this.logger.warn(
        `Falha de rede ao chamar Evolution API (${method} ${path}): ${(error as Error).message}`,
      );
      throw new Error('Evolution API indisponível.');
    }

    const json = (await response.json().catch(() => null)) as
      | T
      | { message?: string | string[]; error?: string }
      | null;

    if (!response.ok) {
      const message =
        json && typeof json === 'object' && 'message' in json && json.message
          ? Array.isArray(json.message)
            ? json.message.join(', ')
            : json.message
          : json &&
              typeof json === 'object' &&
              'error' in json &&
              typeof json.error === 'string'
            ? json.error
            : `Erro ${response.status} na Evolution API.`;
      throw new Error(message);
    }

    return json as T;
  }

  private async fetchInstances(): Promise<EvolutionInstanceRecord[]> {
    const data = await this.request<EvolutionInstanceRecord[] | { instances?: EvolutionInstanceRecord[] }>(
      'GET',
      '/instance/fetchInstances',
    );

    if (Array.isArray(data)) return data;
    if (Array.isArray(data.instances)) return data.instances;
    return [];
  }

  private extractConnectionState(
    connection: EvolutionConnectionResponse,
  ): string | undefined {
    return connection.instance?.state ?? connection.connectionStatus;
  }

  private async fetchConnectionState(): Promise<EvolutionConnectionResponse> {
    const instance = await this.resolveInstanceName();
    return this.request<EvolutionConnectionResponse>(
      'GET',
      `/instance/connectionState/${encodeURIComponent(instance)}`,
    );
  }

  async getStatus(): Promise<WhatsAppStatusResp> {
    const connection = await this.fetchConnectionState();
    return { status: this.mapEvolutionState(this.extractConnectionState(connection)) };
  }

  async connect(): Promise<WhatsAppStatusResp> {
    const instance = await this.resolveInstanceName();
    const connect = await this.request<EvolutionConnectResponse>(
      'GET',
      `/instance/connect/${encodeURIComponent(instance)}`,
    );
    const connection = await this.fetchConnectionState();
    const status = this.mapEvolutionState(this.extractConnectionState(connection));

    if (status === 'conectado') {
      return { status };
    }

    const qrImagem = this.normalizeQr(connect.base64);
    return {
      status: qrImagem ? 'aguardando_qr' : status === 'desconectado' ? 'conectando' : status,
      qrImagem,
    };
  }

  async logout(): Promise<void> {
    const instance = await this.resolveInstanceName();
    await this.request<Record<string, never>>(
      'DELETE',
      `/instance/logout/${encodeURIComponent(instance)}`,
    );
  }

  async enviarMensagem(numero: string, texto: string): Promise<void> {
    const instance = await this.resolveInstanceName();
    await this.request<Record<string, unknown>>(
      'POST',
      `/message/sendText/${encodeURIComponent(instance)}`,
      {
        number: formatarNumeroEvolution(numero),
        text: texto,
      },
    );
    void this.metrics.incrementarMensagens(1).catch(() => undefined);
  }

  async enviarImagem(
    numero: string,
    imagem: string,
    legenda?: string,
  ): Promise<void> {
    const instance = await this.resolveInstanceName();
    let media = imagem.trim();
    let mimetype = 'image/jpeg';

    if (media.startsWith('data:')) {
      const match = /^data:([^;]+);base64,/i.exec(media);
      if (match?.[1]) mimetype = match[1];
    } else if (/^https?:\/\//i.test(media)) {
      mimetype = 'image/jpeg';
    } else {
      media = `data:image/jpeg;base64,${media}`;
    }

    await this.request<Record<string, unknown>>(
      'POST',
      `/message/sendMedia/${encodeURIComponent(instance)}`,
      {
        number: formatarNumeroEvolution(numero),
        mediatype: 'image',
        mimetype,
        caption: legenda,
        media,
      },
    );
    void this.metrics.incrementarMensagens(1).catch(() => undefined);
  }

  async estaConectado(): Promise<boolean> {
    try {
      const connection = await this.fetchConnectionState();
      return (
        this.mapEvolutionState(this.extractConnectionState(connection)) ===
        'conectado'
      );
    } catch {
      return false;
    }
  }

  async getOverview(): Promise<WhatsappOverview> {
    const agora = new Date();
    const base = await this.getStatus();
    const [empresas, hoje, mes, eventos, eventosJanela, instances] =
      await Promise.all([
        this.metrics.contarEmpresasUtilizando(),
        this.metrics.mensagensHoje(),
        this.metrics.mensagens30d(agora),
        this.metrics.eventosRecentes(20),
        this.metrics.eventosJanela(30, agora),
        this.fetchInstances().catch(() => [] as EvolutionInstanceRecord[]),
      ]);

    const instanceName = await this.resolveInstanceName();
    const current =
      instances.find(
        (item) =>
          item.instance?.instanceName === instanceName || item.name === instanceName,
      ) ?? instances[0];

    return montarOverview({
      status: base.status,
      qrImagem: base.qrImagem,
      numeroConectado:
        current?.owner?.trim() ||
        current?.instance?.owner?.trim() ||
        (current as { number?: string })?.number?.trim() ||
        null,
      nomeSessao:
        current?.profileName?.trim() ||
        current?.instance?.profileName?.trim() ||
        instanceName,
      conectadoDesde: null,
      ultimaAtividade: null,
      versaoSessao: 'Evolution API',
      ambiente: process.env.NODE_ENV === 'production' ? 'prod' : 'dev',
      empresasUtilizando: empresas,
      mensagensHoje: hoje,
      mensagens30d: mes,
      disponibilidade: calcularDisponibilidade(eventosJanela, agora, 30),
      eventos,
    });
  }
}
