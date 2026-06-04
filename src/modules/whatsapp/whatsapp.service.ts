import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Boom } from '@hapi/boom';
import * as QRCode from 'qrcode';
import type { WASocket } from '@whiskeysockets/baileys';
import { FirebaseService } from '../../config/firebase.service';
import { useFirestoreAuthState } from './firestore-auth-state';
import { formatarJid } from './phone';

export type WhatsAppStatus =
  | 'desconectado'
  | 'conectando'
  | 'aguardando_qr'
  | 'conectado';

/**
 * Conexão WhatsApp (Baileys) — UM remetente para toda a plataforma. Baileys 7 é
 * ESM-only e o backend é CommonJS, então o socket é criado via `import()`
 * dinâmico. A sessão (auth) é persistida no Firestore.
 */
@Injectable()
export class WhatsAppService implements OnModuleInit {
  private readonly logger = new Logger(WhatsAppService.name);
  private sock: WASocket | null = null;
  private status: WhatsAppStatus = 'desconectado';
  private qrAtual: string | null = null;
  private conectando = false;

  constructor(private firebase: FirebaseService) {}

  private get docRef() {
    return this.firebase
      .getFirestore()
      .collection('whatsappSessions')
      .doc('default');
  }

  /** Reconecta automaticamente se já houver uma sessão registrada. */
  async onModuleInit(): Promise<void> {
    try {
      const snap = await this.docRef.get();
      const credsRaw = (snap.data() as { creds?: string } | undefined)?.creds;
      const registered =
        !!credsRaw && !!(JSON.parse(credsRaw) as { registered?: boolean })?.registered;
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

  estaConectado(): boolean {
    return this.status === 'conectado';
  }

  async connect(): Promise<void> {
    if (this.sock || this.conectando) return;
    this.conectando = true;
    try {
      const baileys = await import('@whiskeysockets/baileys');
      const makeWASocket = baileys.default as unknown as (
        config: unknown,
      ) => WASocket;
      const { DisconnectReason } = baileys;
      const { state, saveCreds } = await useFirestoreAuthState(this.docRef);

      this.status = 'conectando';
      const sock = makeWASocket({
        auth: state,
        browser: ['Hora Util 360', 'Chrome', '1.0'],
      });
      this.sock = sock;

      sock.ev.on('creds.update', saveCreds);
      sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        if (qr) {
          this.qrAtual = qr;
          this.status = 'aguardando_qr';
        }
        if (connection === 'open') {
          this.status = 'conectado';
          this.qrAtual = null;
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
            this.logger.warn('WhatsApp deslogado — sessão encerrada.');
            void this.limparSessao();
          } else {
            this.status = 'conectando';
            this.logger.warn('Conexão WhatsApp caiu — reconectando…');
            void this.connect();
          }
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
    let qrImagem: string | undefined;
    if (this.status === 'aguardando_qr' && this.qrAtual) {
      qrImagem = await QRCode.toDataURL(this.qrAtual);
    }
    return { status: this.status, qrImagem };
  }

  async enviarMensagem(numero: string, texto: string): Promise<void> {
    if (!this.sock || this.status !== 'conectado') {
      throw new Error('WhatsApp não está conectado.');
    }
    await this.sock.sendMessage(formatarJid(numero), { text: texto });
  }

  async logout(): Promise<void> {
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

  private async limparSessao(): Promise<void> {
    try {
      await this.docRef.delete();
    } catch {
      /* ignora */
    }
  }
}
