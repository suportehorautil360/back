import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Boom } from '@hapi/boom';
import * as QRCode from 'qrcode';
import type { WASocket } from '@whiskeysockets/baileys';
import { PrismaService } from '../../prisma/prisma.service';
import {
  usePrismaAuthState,
  WHATSAPP_PLATFORM_SESSION_ID,
} from './prisma-auth-state';
import { formatarJid } from './phone';
import { WhatsAppMetricsService } from './whatsapp-metrics.service';
import {
  montarOverview,
  type WhatsappOverview,
  type WhatsAppStatus,
} from './whatsapp-metrics';
import { WhatsAppRemoteClient } from './whatsapp-remote.client';
import { WhatsAppEvolutionClient } from './whatsapp-evolution.client';

export type { WhatsAppStatus };

type ExternalWhatsAppClient = WhatsAppEvolutionClient | WhatsAppRemoteClient;

/**
 * WhatsApp da plataforma: Baileys local, Evolution API ou proxy HTTP genérico.
 * Emergências e o Hub admin usam esta classe.
 */
@Injectable()
export class WhatsAppService implements OnModuleInit {
  private readonly logger = new Logger(WhatsAppService.name);
  private sock: WASocket | null = null;
  private status: WhatsAppStatus = 'desconectado';
  private qrAtual: string | null = null;
  private conectando = false;
  /** Falhas consecutivas sem chegar a QR/conexão (evita martelar o WhatsApp). */
  private tentativas = 0;
  private static readonly MAX_TENTATIVAS = 5;
  private conectadoDesde: string | null = null;
  private ultimaAtividade: string | null = null;
  private versaoSessao: string | null = null;
  /** Evita reconectar automaticamente após `logout()` do admin. */
  private desconexaoIntencional = false;

  constructor(
    private readonly prisma: PrismaService,
    private metrics: WhatsAppMetricsService,
    private remote: WhatsAppRemoteClient,
    private evolution: WhatsAppEvolutionClient,
  ) {}

  private external(): ExternalWhatsAppClient | null {
    if (this.evolution.isEnabled()) return this.evolution;
    if (this.remote.isEnabled()) return this.remote;
    return null;
  }

  private useExternal(): boolean {
    return this.external() != null;
  }

  private externalModeLabel(): string {
    return this.evolution.isEnabled() ? 'Evolution API' : 'serviço remoto';
  }

  /** Reconecta automaticamente se já houver uma sessão registrada (modo local). */
  async onModuleInit(): Promise<void> {
    if (this.useExternal()) {
      this.logger.log(
        `${this.externalModeLabel()} configurado — Baileys local desativado.`,
      );
      if (this.evolution.isEnabled()) {
        void this.evolution.ensureSessionOnStartup();
      }
      return;
    }

    try {
      const row = await this.prisma.whatsappPlatformSession.findUnique({
        where: { id: WHATSAPP_PLATFORM_SESSION_ID },
      });
      const credsRaw = row?.creds;
      const registered =
        !!credsRaw &&
        !!(JSON.parse(credsRaw) as { registered?: boolean })?.registered;
      if (row?.conectadoDesde) {
        this.conectadoDesde = row.conectadoDesde.toISOString();
      }
      if (row?.versaoSessao) this.versaoSessao = row.versaoSessao;
      if (registered) {
        this.logger.log('Sessão WhatsApp encontrada — reconectando…');
        await this.connect();
      }
    } catch (e) {
      this.logger.warn(
        `Não foi possível verificar a sessão WhatsApp: ${(e as Error).message}`,
      );
    }
  }

  async estaConectado(): Promise<boolean> {
    const external = this.external();
    if (external) {
      return external.estaConectado();
    }
    return this.status === 'conectado';
  }

  async connect(options?: { recriar?: boolean }): Promise<void> {
    if (this.evolution.isEnabled()) {
      await this.evolution.connect(options);
      return;
    }

    const external = this.external();
    if (external) {
      await external.connect();
      return;
    }

    if (options?.recriar) {
      await this.resetLocalSession();
    }

    if (this.sock || this.conectando) return;
    if (this.status === 'desconectado') this.tentativas = 0;
    this.conectando = true;
    try {
      const baileys = await import('@whiskeysockets/baileys');
      const makeWASocket = baileys.default as unknown as (
        config: unknown,
      ) => WASocket;
      const { DisconnectReason, fetchLatestBaileysVersion } = baileys;
      const { state, saveCreds } = await usePrismaAuthState(this.prisma);
      const { version } = await fetchLatestBaileysVersion();
      this.versaoSessao = version.join('.');
      void this.metrics.registrarEvento('sessao_iniciada', 'sucesso');

      this.status = 'conectando';
      const sock = makeWASocket({
        version,
        auth: state,
        browser: ['Hora Util 360', 'Chrome', '1.0'],
        syncFullHistory: false,
      });
      this.sock = sock;

      sock.ev.on('creds.update', saveCreds);
      sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        if (qr) {
          this.qrAtual = qr;
          this.status = 'aguardando_qr';
          this.tentativas = 0;
          void this.metrics.registrarEvento('qr_gerado', 'sucesso');
        }
        if (connection === 'open') {
          this.status = 'conectado';
          this.qrAtual = null;
          this.tentativas = 0;
          this.conectadoDesde = new Date().toISOString();
          this.ultimaAtividade = this.conectadoDesde;
          void this.persistirSessao();
          void this.metrics.registrarEvento('conectado', 'sucesso');
          this.logger.log('WhatsApp conectado.');
        } else if (connection === 'close') {
          const err = lastDisconnect?.error;
          const loggedOut =
            err instanceof Boom &&
            err.output?.statusCode === DisconnectReason.loggedOut;
          this.sock = null;
          this.qrAtual = null;
          if (loggedOut) {
            const estavaPareando =
              this.status === 'conectando' || this.status === 'aguardando_qr';
            this.status = 'desconectado';
            this.conectadoDesde = null;
            void this.metrics.registrarEvento('sessao_encerrada', 'aviso');
            this.logger.warn('WhatsApp deslogado — sessão encerrada.');
            void this.limparSessao().then(() => {
              if (!this.desconexaoIntencional && estavaPareando) {
                setTimeout(() => void this.connect({ recriar: true }), 500);
              }
            });
            return;
          }
          void this.metrics.registrarEvento('queda', 'aviso');
          this.tentativas += 1;
          if (this.tentativas > WhatsAppService.MAX_TENTATIVAS) {
            this.status = 'desconectado';
            this.logger.error(
              'WhatsApp: muitas falhas de conexão — parando. Clique em Conectar para tentar de novo.',
            );
            return;
          }
          this.status = 'conectando';
          this.logger.warn(
            `Conexão WhatsApp caiu — reconectando (tentativa ${this.tentativas})…`,
          );
          setTimeout(() => void this.connect(), 3000);
        }
      });
    } catch (e) {
      this.status = 'desconectado';
      this.sock = null;
      this.logger.error(`Erro ao conectar WhatsApp: ${(e as Error).message}`);
    } finally {
      this.conectando = false;
    }
  }

  async getStatus(): Promise<{ status: WhatsAppStatus; qrImagem?: string }> {
    const external = this.external();
    if (external) {
      return external.getStatus();
    }

    let qrImagem: string | undefined;
    if (this.status === 'aguardando_qr' && this.qrAtual) {
      qrImagem = await QRCode.toDataURL(this.qrAtual);
    }
    return { status: this.status, qrImagem };
  }

  async enviarMensagem(numero: string, texto: string): Promise<void> {
    const external = this.external();
    if (external) {
      await external.enviarMensagem(numero, texto);
      return;
    }

    if (!this.sock || this.status !== 'conectado') {
      throw new Error('WhatsApp não está conectado.');
    }
    await this.sock.sendMessage(formatarJid(numero), { text: texto });
    this.ultimaAtividade = new Date().toISOString();
    void this.metrics.incrementarMensagens(1).catch(() => undefined);
  }

  async enviarImagem(
    numero: string,
    imagem: string,
    legenda?: string,
  ): Promise<void> {
    const external = this.external();
    if (external) {
      await external.enviarImagem(numero, imagem, legenda);
      return;
    }

    if (!this.sock || this.status !== 'conectado') {
      throw new Error('WhatsApp não está conectado.');
    }
    const jid = formatarJid(numero);
    if (/^https?:\/\//i.test(imagem)) {
      await this.sock.sendMessage(jid, {
        image: { url: imagem },
        caption: legenda,
      });
      this.ultimaAtividade = new Date().toISOString();
      void this.metrics.incrementarMensagens(1).catch(() => undefined);
      return;
    }
    const base64 = imagem.includes(',')
      ? imagem.slice(imagem.indexOf(',') + 1)
      : imagem;
    await this.sock.sendMessage(jid, {
      image: Buffer.from(base64, 'base64'),
      caption: legenda,
    });
    this.ultimaAtividade = new Date().toISOString();
    void this.metrics.incrementarMensagens(1).catch(() => undefined);
  }

  async logout(): Promise<void> {
    const external = this.external();
    if (external) {
      await external.logout();
      return;
    }

    this.desconexaoIntencional = true;
    try {
      await this.sock?.logout();
    } catch {
      /* ignora erro de logout (socket pode já estar caído) */
    } finally {
      this.desconexaoIntencional = false;
    }
    this.sock = null;
    this.status = 'desconectado';
    this.qrAtual = null;
    await this.limparSessao();
  }

  async getOverview(): Promise<WhatsappOverview> {
    const external = this.external();
    if (external) {
      const ov = await external.getOverview();
      if (ov.integracao) return ov;
      return {
        ...ov,
        integracao: this.evolution.isEnabled() ? 'evolution' : 'remote',
        evolutionManagerUrl: this.evolution.isEnabled()
          ? this.evolution.managerUrl()
          : null,
      };
    }

    const agora = new Date();
    const base = await this.getStatus();
    const metricas = await this.metrics.carregarMetricasOverview(agora);
    return montarOverview({
      status: base.status,
      qrImagem: base.qrImagem,
      integracao: 'baileys',
      evolutionManagerUrl: null,
      numeroConectado: this.numeroConectado(),
      nomeSessao: this.nomeSessao(),
      conectadoDesde: this.conectadoDesde,
      ultimaAtividade: this.ultimaAtividade,
      versaoSessao: this.versaoSessao,
      ambiente: this.ambiente(),
      empresasUtilizando: metricas.empresasUtilizando,
      mensagensHoje: metricas.mensagensHoje,
      mensagens30d: metricas.mensagens30d,
      disponibilidade: metricas.disponibilidade,
      eventos: metricas.eventos,
    });
  }

  private async persistirSessao(): Promise<void> {
    try {
      await this.prisma.whatsappPlatformSession.upsert({
        where: { id: WHATSAPP_PLATFORM_SESSION_ID },
        create: {
          id: WHATSAPP_PLATFORM_SESSION_ID,
          conectadoDesde: this.conectadoDesde
            ? new Date(this.conectadoDesde)
            : null,
          versaoSessao: this.versaoSessao,
        },
        update: {
          conectadoDesde: this.conectadoDesde
            ? new Date(this.conectadoDesde)
            : null,
          versaoSessao: this.versaoSessao,
        },
      });
    } catch {
      /* best-effort */
    }
  }

  private numeroConectado(): string | null {
    const id = this.sock?.user?.id;
    return id ? id.split(':')[0].split('@')[0] : null;
  }

  private nomeSessao(): string | null {
    return this.sock?.user?.name ?? (this.sock ? 'Hora Útil 360' : null);
  }

  private ambiente(): 'dev' | 'prod' {
    return process.env.NODE_ENV === 'production' ? 'prod' : 'dev';
  }

  private async resetLocalSession(): Promise<void> {
    if (this.sock) {
      try {
        this.sock.end(undefined);
      } catch {
        /* socket pode já estar fechado */
      }
      this.sock = null;
    }
    this.qrAtual = null;
    this.conectando = false;
    this.status = 'desconectado';
    this.tentativas = 0;
    this.conectadoDesde = null;
    await this.limparSessao();
  }

  private async limparSessao(): Promise<void> {
    try {
      await this.prisma.whatsappPlatformSession.deleteMany({
        where: { id: WHATSAPP_PLATFORM_SESSION_ID },
      });
    } catch {
      /* ignora */
    }
  }
}
