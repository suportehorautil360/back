import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { formatarNumeroEvolution, prepararMediaEvolution } from './phone';
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
  disconnectionReasonCode?: number;
  disconnectionObject?: string;
  disconnectionAt?: string;
  ownerJid?: string;
};

/** Sessão inválida após logout, device_removed ou reconexão travada. */
export function isBrokenEvolutionInstance(
  record: Record<string, unknown>,
): boolean {
  const status = String(
    record.connectionStatus ??
      (record.instance as { status?: string } | undefined)?.status ??
      '',
  )
    .trim()
    .toLowerCase();

  const reason = Number(record.disconnectionReasonCode);
  const discObj = String(record.disconnectionObject ?? '');

  if (reason === 401 || discObj.includes('device_removed')) {
    return true;
  }

  if (status === 'connecting' && record.disconnectionAt) {
    return true;
  }

  return false;
}

/** Extrai mensagem legível do corpo de erro da Evolution (vários formatos). */
export function extractEvolutionErrorMessage(
  json: unknown,
  status: number,
): string {
  if (!json || typeof json !== 'object') {
    return `HTTP ${status} na Evolution API.`;
  }

  const obj = json as Record<string, unknown>;
  const nested =
    obj.response && typeof obj.response === 'object'
      ? (obj.response as Record<string, unknown>)
      : null;

  for (const source of [nested, obj]) {
    if (!source || !('message' in source)) continue;
    const raw = source.message;
    if (typeof raw === 'string' && raw.trim()) return raw.trim();
    if (Array.isArray(raw)) {
      const joined = raw
        .map((item) => String(item).trim())
        .filter(Boolean)
        .join('; ');
      if (joined) return joined;
    }
  }

  if (typeof obj.error === 'string' && obj.error.trim()) {
    return obj.error.trim();
  }

  return `HTTP ${status} na Evolution API.`;
}

/** Trunca campos pesados (base64) antes de logar o payload enviado. */
export function sanitizeEvolutionPayloadForLog(body: unknown): unknown {
  if (!body || typeof body !== 'object') return body;
  const copy = { ...(body as Record<string, unknown>) };
  if (typeof copy.media === 'string') {
    const media = copy.media;
    copy.media =
      media.length > 80
        ? `${media.slice(0, 40)}…[${media.length} chars]`
        : media;
  }
  if (typeof copy.text === 'string' && copy.text.length > 200) {
    copy.text = `${copy.text.slice(0, 200)}…[${copy.text.length} chars]`;
  }
  return copy;
}

@Injectable()
export class WhatsAppEvolutionClient {
  private readonly logger = new Logger(WhatsAppEvolutionClient.name);
  private cachedInstanceName: string | null = null;
  /** QR em cache (~60s) para o Hub admin enquanto aguarda leitura. */
  private qrCache: {
    imagem: string;
    at: number;
    status: WhatsAppStatus;
  } | null = null;

  private static readonly QR_CACHE_MS = 55_000;

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

  private findInstanceRecord(
    instances: EvolutionInstanceRecord[],
    name: string,
  ): EvolutionInstanceRecord | undefined {
    return instances.find(
      (item) =>
        item.instance?.instanceName?.trim() === name ||
        item.name?.trim() === name,
    );
  }

  private async deleteInstance(name: string): Promise<void> {
    try {
      await this.request(
        'DELETE',
        `/instance/delete/${encodeURIComponent(name)}`,
      );
    } catch (error) {
      this.logger.warn(
        `Evolution: falha ao excluir instância "${name}": ${(error as Error).message}`,
      );
    }
    if (this.cachedInstanceName === name) {
      this.cachedInstanceName = null;
    }
    this.qrCache = null;
  }

  private async createInstance(
    name: string,
  ): Promise<EvolutionConnectResponse | null> {
    const data = await this.request<{ qrcode?: EvolutionConnectResponse }>(
      'POST',
      '/instance/create',
      {
        instanceName: name,
        integration: 'WHATSAPP-BAILEYS',
        qrcode: true,
      },
    );
    return data.qrcode ?? null;
  }

  /**
   * Garante instância existente e saudável. Recria automaticamente após
   * device_removed / logout (causa comum do "não foi possível conectar").
   */
  private async ensureInstanceReady(): Promise<EvolutionConnectResponse | null> {
    const name = await this.resolveInstanceName();
    const instances = await this.fetchInstances();
    const current = this.findInstanceRecord(instances, name);

    if (!current) {
      this.logger.log(`Evolution: criando instância "${name}"…`);
      return this.createInstance(name);
    }

    if (isBrokenEvolutionInstance(current as Record<string, unknown>)) {
      this.logger.warn(
        `Evolution: instância "${name}" com sessão inválida — recriando…`,
      );
      await this.deleteInstance(name);
      await new Promise((resolve) => setTimeout(resolve, 2000));
      return this.createInstance(name);
    }

    return null;
  }

  private buildConnectResponse(
    connect: EvolutionConnectResponse,
    status: WhatsAppStatus,
  ): WhatsAppStatusResp {
    if (status === 'conectado') {
      this.qrCache = null;
      return { status };
    }

    const qrImagem = this.normalizeQr(connect.base64);
    const resolvedStatus = qrImagem
      ? 'aguardando_qr'
      : status === 'desconectado'
        ? 'conectando'
        : status;

    this.storeQrCache(resolvedStatus, qrImagem);

    return {
      status: resolvedStatus,
      qrImagem,
    };
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
      const message = extractEvolutionErrorMessage(json, response.status);
      this.logger.warn(
        [
          `Evolution API ${method} ${path} → HTTP ${response.status}: ${message}`,
          json ? `resposta=${JSON.stringify(json)}` : 'resposta=vazia',
          body !== undefined
            ? `payload=${JSON.stringify(sanitizeEvolutionPayloadForLog(body))}`
            : null,
        ]
          .filter(Boolean)
          .join(' | '),
      );
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
    const status = this.mapEvolutionState(this.extractConnectionState(connection));

    if (status === 'conectado') {
      this.qrCache = null;
      return { status };
    }

    const cached = this.readQrCache();
    if (cached) {
      return cached;
    }

    return { status };
  }

  /**
   * Ao subir o back, tenta reutilizar a sessão já pareada na Evolution
   * (evita pedir QR de novo após restart do Nest ou da Evolution).
   */
  async ensureSessionOnStartup(): Promise<void> {
    try {
      const atual = await this.getStatus();
      if (atual.status === 'conectado') {
        this.logger.log('Evolution: instância já conectada.');
        return;
      }

      this.logger.log('Evolution: restaurando sessão da instância…');
      const result = await this.connect();

      if (result.status === 'conectado') {
        this.logger.log('Evolution: sessão restaurada automaticamente.');
      } else if (result.qrImagem) {
        this.logger.warn(
          'Evolution: sessão expirada — escaneie o QR no Hub admin.',
        );
      }
    } catch (error) {
      this.logger.warn(
        `Evolution: não foi possível restaurar sessão no startup: ${(error as Error).message}`,
      );
    }
  }

  private readQrCache(): WhatsAppStatusResp | null {
    if (!this.qrCache) return null;
    if (Date.now() - this.qrCache.at > WhatsAppEvolutionClient.QR_CACHE_MS) {
      this.qrCache = null;
      return null;
    }
    return {
      status: this.qrCache.status,
      qrImagem: this.qrCache.imagem,
    };
  }

  private storeQrCache(status: WhatsAppStatus, qrImagem?: string): void {
    if (!qrImagem) return;
    this.qrCache = {
      imagem: qrImagem,
      at: Date.now(),
      status: status === 'conectando' ? 'aguardando_qr' : status,
    };
  }

  async connect(): Promise<WhatsAppStatusResp> {
    const fromCreate = await this.ensureInstanceReady();
    if (fromCreate?.base64) {
      return this.buildConnectResponse(fromCreate, 'conectando');
    }

    const instance = await this.resolveInstanceName();
    const connect = await this.request<EvolutionConnectResponse>(
      'GET',
      `/instance/connect/${encodeURIComponent(instance)}`,
    );
    const connection = await this.fetchConnectionState();
    const status = this.mapEvolutionState(this.extractConnectionState(connection));

    return this.buildConnectResponse(connect, status);
  }

  async logout(): Promise<void> {
    const instance = await this.resolveInstanceName();
    this.qrCache = null;
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
    const { media, mimetype } = prepararMediaEvolution(imagem);

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
