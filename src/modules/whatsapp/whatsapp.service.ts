import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Boom } from '@hapi/boom';
import * as QRCode from 'qrcode';
import type { WASocket } from '@whiskeysockets/baileys';
import { FirebaseService } from '../../config/firebase.service';
import { useFirestoreAuthState } from './firestore-auth-state';
import { formatarJid } from './phone';
import { WhatsAppMetricsService } from './whatsapp-metrics.service';
import {
  calcularDisponibilidade,
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

  constructor(
    private firebase: FirebaseService,
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

  private get docRef() {
    return this.firebase
      .getFirestore()
      .collection('whatsappSessions')
      .doc('default');
  }

  /** Reconecta automaticamente se já houver uma sessão registrada (modo local). */
  async onModuleInit(): Promise<void> {
    if (this.useExternal()) {
      this.logger.log(
        `${this.externalModeLabel()} configurado — Baileys local desativado.`,
      );
      return;
    }

    try {
      const snap = await this.docRef.get();
      const credsRaw = (snap.data() as { creds?: string } | undefined)?.creds;
      const registered =
        !!credsRaw && !!(JSON.parse(credsRaw) as { registered?: boolean })?.registered;
      const data = snap.data() as { conectadoDesde?: string; versaoSessao?: string } | undefined;
      if (data?.conectadoDesde) this.conectadoDesde = data.conectadoDesde;
      if (data?.versaoSessao) this.versaoSessao = data.versaoSessao;
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

  async connect(): Promise<void> {
    const external = this.external();
    if (external) {
      await external.connect();
      return;
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
      const { state, saveCreds } = await useFirestoreAuthState(this.docRef);
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
            this.status = 'desconectado';
            this.conectadoDesde = null;
            void this.metrics.registrarEvento('sessao_encerrada', 'aviso');
            this.logger.warn('WhatsApp deslogado — sessão encerrada.');
            void this.limparSessao();
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

    try {
      await this.sock?.logout();
    } catch {
      /* ignora erro de logout (socket pode já estar caído) */
    }
    this.sock = null;
    this.status = 'desconectado';
    this.qrAtual = null;
    await this.limparSessao();
  }

  async getOverview(): Promise<WhatsappOverview> {
    const external = this.external();
    if (external) {
      return external.getOverview();
    }

    const agora = new Date();
    const base = await this.getStatus();
    const [empresas, hoje, mes, eventos, eventosJanela] = await Promise.all([
      this.metrics.contarEmpresasUtilizando(),
      this.metrics.mensagensHoje(),
      this.metrics.mensagens30d(agora),
      this.metrics.eventosRecentes(20),
      this.metrics.eventosJanela(30, agora),
    ]);
    return montarOverview({
      status: base.status,
      qrImagem: base.qrImagem,
      numeroConectado: this.numeroConectado(),
      nomeSessao: this.nomeSessao(),
      conectadoDesde: this.conectadoDesde,
      ultimaAtividade: this.ultimaAtividade,
      versaoSessao: this.versaoSessao,
      ambiente: this.ambiente(),
      empresasUtilizando: empresas,
      mensagensHoje: hoje,
      mensagens30d: mes,
      disponibilidade: calcularDisponibilidade(eventosJanela, agora, 30),
      eventos,
    });
  }

  private async persistirSessao(): Promise<void> {
    try {
      await this.docRef.set(
        { conectadoDesde: this.conectadoDesde, versaoSessao: this.versaoSessao },
        { merge: true },
      );
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

  private async limparSessao(): Promise<void> {
    try {
      await this.docRef.delete();
    } catch {
      /* ignora */
    }
  }
}
