import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { FirebaseService } from '../../config/firebase.service';
import type { CreateMensagemSuporteDto } from './dto/create-mensagem.dto';
import {
  parseSuporteChannel,
  canalJaTemMensagemDoUsuario,
} from './helpers/suporte-channel.helper';
import {
  paginateMensagens,
  withPostoWelcomeMessages,
  withWelcomeMessage,
} from './helpers/suporte-mensagens.helper';
import { mapMensagemToApi } from './helpers/suporte-response.helper';
import {
  buildAutoReplyForPosto,
  buildAutoReplyMessage,
} from './helpers/suporte-welcome.helper';
import { agruparThreadsPosto, agruparThreadsOficina } from './helpers/suporte-inbox.helper';
import type { CreateMensagemSuportePostoDto } from './dto/create-mensagem-posto.dto';
import type { ResponderSuporteDto } from './dto/responder-suporte.dto';
import type {
  SuporteChannel,
  SuporteMensagemApi,
  SuporteResumoApi,
  SuporteThreadApi,
  SuporteThreadOficinaApi,
} from './suporte.types';

const DEFAULT_LIMIT = 50;

function texto(valor: unknown): string {
  return typeof valor === 'string' ? valor.trim() : '';
}

@Injectable()
export class SuporteService {
  constructor(private readonly firebaseService: FirebaseService) {}

  private get mensagensCollection() {
    return this.firebaseService.getFirestore().collection('suporteMensagens');
  }

  private get oficinasCollection() {
    return this.firebaseService.getFirestore().collection('oficinas');
  }

  private get postosCollection() {
    return this.firebaseService.getFirestore().collection('postos');
  }

  private async assertOficinaExists(oficinaId: string): Promise<void> {
    const snap = await this.oficinasCollection.doc(oficinaId).get();
    if (snap.exists) return;

    const byField = await this.oficinasCollection
      .where('id', '==', oficinaId)
      .limit(1)
      .get();

    if (!byField.empty) return;

    throw new NotFoundException('Oficina não encontrada.');
  }

  /** Mensagens de postos da prefeitura (por prefeituraId ou postoId cadastrado). */
  private async loadMensagensPrefeitura(
    prefeituraId: string,
  ): Promise<SuporteMensagemApi[]> {
    const id = prefeituraId.trim();
    const mapa = new Map<string, SuporteMensagemApi>();

    const byPref = await this.mensagensCollection
      .where('prefeituraId', '==', id)
      .get();
    for (const doc of byPref.docs) {
      const m = mapMensagemToApi(
        doc.id,
        doc.data() as Record<string, unknown>,
      );
      if (m.postoId) mapa.set(m.id, m);
    }

    const postosSnap = await this.postosCollection
      .where('prefeituraId', '==', id)
      .get();
    const postoIds = postosSnap.docs.map(
      (doc) => (doc.data().id as string | undefined) ?? doc.id,
    );

    for (let i = 0; i < postoIds.length; i += 10) {
      const lote = postoIds.slice(i, i + 10);
      if (lote.length === 0) continue;
      const snap = await this.mensagensCollection
        .where('postoId', 'in', lote)
        .get();
      for (const doc of snap.docs) {
        const m = mapMensagemToApi(
          doc.id,
          doc.data() as Record<string, unknown>,
        );
        if (!mapa.has(m.id)) mapa.set(m.id, m);
      }
    }

    return [...mapa.values()];
  }

  private async loadChannelMessagesPosto(
    postoId: string,
    channel: SuporteChannel,
  ): Promise<SuporteMensagemApi[]> {
    const snap = await this.mensagensCollection
      .where('postoId', '==', postoId)
      .where('channel', '==', channel)
      .get();

    return snap.docs
      .map((doc) =>
        mapMensagemToApi(doc.id, doc.data() as Record<string, unknown>),
      )
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  private async loadChannelMessages(
    oficinaId: string,
    channel: SuporteChannel,
  ): Promise<SuporteMensagemApi[]> {
    const snap = await this.mensagensCollection
      .where('oficinaId', '==', oficinaId)
      .where('channel', '==', channel)
      .get();

    return snap.docs
      .map((doc) =>
        mapMensagemToApi(doc.id, doc.data() as Record<string, unknown>),
      )
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async listarMensagens(
    oficinaId: string,
    channelRaw: unknown,
    limitRaw?: number,
    before?: string,
  ): Promise<{
    data: { channel: SuporteChannel; messages: SuporteMensagemApi[] };
    message: string;
  }> {
    const id = oficinaId.trim();
    const channel = parseSuporteChannel(channelRaw);
    const limit = Math.min(Math.max(limitRaw ?? DEFAULT_LIMIT, 1), 100);

    if (!id) {
      throw new BadRequestException('oficinaId inválido.');
    }

    await this.assertOficinaExists(id);

    try {
      const persisted = await this.loadChannelMessages(id, channel);
      const page = paginateMensagens(persisted, limit, before);
      const messages = withWelcomeMessage(id, channel, page);

      return {
        data: { channel, messages },
        message: 'Mensagens carregadas com sucesso.',
      };
    } catch (error) {
      if (
        error instanceof BadRequestException ||
        error instanceof NotFoundException
      ) {
        throw error;
      }
      console.error('Erro ao listar mensagens de suporte:', error);
      throw new InternalServerErrorException(
        'Não foi possível carregar as mensagens de suporte.',
      );
    }
  }

  async enviarMensagem(
    oficinaId: string,
    dto: CreateMensagemSuporteDto,
    context?: { parceiroId?: string; prefeituraId?: string },
  ): Promise<{
    data: {
      message: SuporteMensagemApi;
      messages: SuporteMensagemApi[];
    };
    message: string;
  }> {
    const id = oficinaId.trim();
    const channel = parseSuporteChannel(dto.channel);
    const text = dto.text.trim();

    if (!id) {
      throw new BadRequestException('oficinaId inválido.');
    }

    if (texto(dto.oficinaId) !== id) {
      throw new BadRequestException(
        'oficinaId do path não confere com o enviado no body.',
      );
    }

    if (!text) {
      throw new BadRequestException('text não pode ser vazio.');
    }

    await this.assertOficinaExists(id);

    const persisted = await this.loadChannelMessages(id, channel);
    const enviarAutoResposta = !canalJaTemMensagemDoUsuario(persisted);

    const userMessageId = randomUUID();
    const userCreatedAt = new Date().toISOString();

    const userMessage: SuporteMensagemApi = {
      id: userMessageId,
      oficinaId: id,
      channel,
      sender: 'user',
      text,
      createdAt: userCreatedAt,
      readAt: null,
      adminReadAt: null,
    };

    const messagesToReturn: SuporteMensagemApi[] = [userMessage];

    try {
      const batch = this.firebaseService.getFirestore().batch();
      const userRef = this.mensagensCollection.doc(userMessageId);

      batch.set(userRef, {
        ...userMessage,
        destino: 'hora-util',
        ...(context?.parceiroId ? { parceiroId: context.parceiroId } : {}),
        ...(context?.prefeituraId ? { prefeituraId: context.prefeituraId } : {}),
      });

      if (enviarAutoResposta) {
        const autoReplyId = randomUUID();
        const autoReplyCreatedAt = new Date(Date.now() + 1000).toISOString();
        const autoReply = buildAutoReplyMessage(
          id,
          channel,
          autoReplyId,
          autoReplyCreatedAt,
        );
        const replyRef = this.mensagensCollection.doc(autoReplyId);
        batch.set(replyRef, {
          ...autoReply,
          readAt: null,
          autoReply: true,
        });
        messagesToReturn.push(autoReply);
      }

      await batch.commit();

      return {
        data: {
          message: userMessage,
          messages: messagesToReturn,
        },
        message: 'Mensagem enviada com sucesso.',
      };
    } catch (error) {
      if (
        error instanceof BadRequestException ||
        error instanceof NotFoundException
      ) {
        throw error;
      }
      console.error('Erro ao enviar mensagem de suporte:', error);
      throw new InternalServerErrorException(
        'Não foi possível enviar a mensagem de suporte.',
      );
    }
  }

  async obterResumo(oficinaId: string): Promise<{
    data: SuporteResumoApi;
    message: string;
  }> {
    const id = oficinaId.trim();
    if (!id) {
      throw new BadRequestException('oficinaId inválido.');
    }

    await this.assertOficinaExists(id);

    try {
      const snap = await this.mensagensCollection
        .where('oficinaId', '==', id)
        .get();

      const messages = snap.docs.map((doc) =>
        mapMensagemToApi(doc.id, doc.data() as Record<string, unknown>),
      );

      const channels: SuporteResumoApi['channels'] = {
        financeiro: { unreadCount: 0, lastMessageAt: null },
        ti: { unreadCount: 0, lastMessageAt: null },
      };

      for (const message of messages) {
        const channel = message.channel;
        if (channel !== 'financeiro' && channel !== 'ti') continue;

        if (
          !channels[channel].lastMessageAt ||
          message.createdAt > channels[channel].lastMessageAt!
        ) {
          channels[channel].lastMessageAt = message.createdAt;
        }

        if (message.sender === 'support' && !message.readAt) {
          channels[channel].unreadCount += 1;
        }
      }

      const unreadCount =
        channels.financeiro.unreadCount + channels.ti.unreadCount;

      return {
        data: {
          unreadCount,
          channels,
          online: true,
        },
        message: 'Resumo de suporte carregado com sucesso.',
      };
    } catch (error) {
      if (
        error instanceof BadRequestException ||
        error instanceof NotFoundException
      ) {
        throw error;
      }
      console.error('Erro ao obter resumo de suporte:', error);
      throw new InternalServerErrorException(
        'Não foi possível carregar o resumo de suporte.',
      );
    }
  }

  async marcarComoLidas(
    oficinaId: string,
    channelRaw: unknown,
  ): Promise<{ data: { updated: number }; message: string }> {
    const id = oficinaId.trim();
    const channel = parseSuporteChannel(channelRaw);

    if (!id) {
      throw new BadRequestException('oficinaId inválido.');
    }

    await this.assertOficinaExists(id);

    try {
      const snap = await this.mensagensCollection
        .where('oficinaId', '==', id)
        .where('channel', '==', channel)
        .get();

      const agora = new Date().toISOString();
      const batch = this.firebaseService.getFirestore().batch();
      let updated = 0;

      for (const doc of snap.docs) {
        const data = doc.data() as Record<string, unknown>;
        if (texto(data.sender) !== 'support') continue;
        if (data.readAt || data.lidoEm) continue;

        batch.update(doc.ref, { readAt: agora });
        updated += 1;
      }

      if (updated > 0) {
        await batch.commit();
      }

      return {
        data: { updated },
        message: 'Mensagens marcadas como lidas.',
      };
    } catch (error) {
      if (
        error instanceof BadRequestException ||
        error instanceof NotFoundException
      ) {
        throw error;
      }
      console.error('Erro ao marcar mensagens como lidas:', error);
      throw new InternalServerErrorException(
        'Não foi possível marcar as mensagens como lidas.',
      );
    }
  }

  // --- Chat de suporte do posto (posto-web) ---

  async listarMensagensPosto(
    postoId: string,
    channelRaw: unknown,
    limitRaw?: number,
    before?: string,
  ): Promise<{
    data: { channel: SuporteChannel; messages: SuporteMensagemApi[] };
    message: string;
  }> {
    const id = postoId.trim();
    const channel = parseSuporteChannel(channelRaw);
    const limit = Math.min(Math.max(limitRaw ?? DEFAULT_LIMIT, 1), 100);

    if (!id) {
      throw new BadRequestException('postoId inválido.');
    }

    try {
      const persisted = await this.loadChannelMessagesPosto(id, channel);
      const page = paginateMensagens(persisted, limit, before);
      const messages = withPostoWelcomeMessages(id, channel, page);

      return {
        data: { channel, messages },
        message: 'Mensagens carregadas com sucesso.',
      };
    } catch (error) {
      if (
        error instanceof BadRequestException ||
        error instanceof NotFoundException
      ) {
        throw error;
      }
      console.error('Erro ao listar mensagens do posto:', error);
      throw new InternalServerErrorException(
        'Não foi possível carregar as mensagens de suporte.',
      );
    }
  }

  async enviarMensagemPosto(
    postoId: string,
    dto: CreateMensagemSuportePostoDto,
    context?: { prefeituraId?: string },
  ): Promise<{
    data: {
      message: SuporteMensagemApi;
      messages: SuporteMensagemApi[];
    };
    message: string;
  }> {
    const id = postoId.trim();
    const channel = parseSuporteChannel(dto.channel);
    const text = dto.text.trim();

    if (!id) {
      throw new BadRequestException('postoId inválido.');
    }

    if (texto(dto.postoId) !== id) {
      throw new BadRequestException(
        'postoId do path não confere com o enviado no body.',
      );
    }

    if (!text) {
      throw new BadRequestException('text não pode ser vazio.');
    }

    const persisted = await this.loadChannelMessagesPosto(id, channel);
    const enviarAutoResposta = !canalJaTemMensagemDoUsuario(persisted);

    const userMessageId = randomUUID();
    const userCreatedAt = new Date().toISOString();

    const userMessage: SuporteMensagemApi = {
      id: userMessageId,
      postoId: id,
      channel,
      sender: 'user',
      text,
      createdAt: userCreatedAt,
      readAt: null,
      adminReadAt: null,
    };

    const prefeituraId =
      texto(context?.prefeituraId) || texto(dto.prefeituraId) || undefined;

    const messagesToReturn: SuporteMensagemApi[] = [userMessage];

    try {
      const batch = this.firebaseService.getFirestore().batch();
      const userRef = this.mensagensCollection.doc(userMessageId);

      batch.set(userRef, {
        ...userMessage,
        destino: 'hora-util',
        ...(prefeituraId ? { prefeituraId } : {}),
      });

      if (enviarAutoResposta) {
        const autoReplyId = randomUUID();
        const autoReplyCreatedAt = new Date(Date.now() + 1000).toISOString();
        const autoReply = buildAutoReplyForPosto(
          id,
          channel,
          autoReplyId,
          autoReplyCreatedAt,
        );
        const replyRef = this.mensagensCollection.doc(autoReplyId);
        batch.set(replyRef, {
          ...autoReply,
          readAt: null,
          autoReply: true,
        });
        messagesToReturn.push(autoReply);
      }

      await batch.commit();

      return {
        data: {
          message: userMessage,
          messages: messagesToReturn,
        },
        message: 'Mensagem enviada com sucesso.',
      };
    } catch (error) {
      if (
        error instanceof BadRequestException ||
        error instanceof NotFoundException
      ) {
        throw error;
      }
      console.error('Erro ao enviar mensagem do posto:', error);
      throw new InternalServerErrorException(
        'Não foi possível enviar a mensagem de suporte.',
      );
    }
  }

  async obterResumoPosto(postoId: string): Promise<{
    data: SuporteResumoApi;
    message: string;
  }> {
    const id = postoId.trim();
    if (!id) {
      throw new BadRequestException('postoId inválido.');
    }

    try {
      const snap = await this.mensagensCollection
        .where('postoId', '==', id)
        .get();

      const messages = snap.docs.map((doc) =>
        mapMensagemToApi(doc.id, doc.data() as Record<string, unknown>),
      );

      const channels: SuporteResumoApi['channels'] = {
        financeiro: { unreadCount: 0, lastMessageAt: null },
        ti: { unreadCount: 0, lastMessageAt: null },
      };

      for (const message of messages) {
        const channel = message.channel;
        if (channel !== 'financeiro' && channel !== 'ti') continue;

        if (
          !channels[channel].lastMessageAt ||
          message.createdAt > channels[channel].lastMessageAt!
        ) {
          channels[channel].lastMessageAt = message.createdAt;
        }

        if (message.sender === 'support' && !message.readAt) {
          channels[channel].unreadCount += 1;
        }
      }

      const unreadCount =
        channels.financeiro.unreadCount + channels.ti.unreadCount;

      return {
        data: {
          unreadCount,
          channels,
          online: true,
        },
        message: 'Resumo de suporte carregado com sucesso.',
      };
    } catch (error) {
      if (
        error instanceof BadRequestException ||
        error instanceof NotFoundException
      ) {
        throw error;
      }
      console.error('Erro ao obter resumo do posto:', error);
      throw new InternalServerErrorException(
        'Não foi possível carregar o resumo de suporte.',
      );
    }
  }

  async marcarComoLidasPosto(
    postoId: string,
    channelRaw: unknown,
  ): Promise<{ data: { updated: number }; message: string }> {
    const id = postoId.trim();
    const channel = parseSuporteChannel(channelRaw);

    if (!id) {
      throw new BadRequestException('postoId inválido.');
    }

    try {
      const snap = await this.mensagensCollection
        .where('postoId', '==', id)
        .where('channel', '==', channel)
        .get();

      const agora = new Date().toISOString();
      const batch = this.firebaseService.getFirestore().batch();
      let updated = 0;

      for (const doc of snap.docs) {
        const data = doc.data() as Record<string, unknown>;
        if (texto(data.sender) !== 'support') continue;
        if (data.readAt || data.lidoEm) continue;

        batch.update(doc.ref, { readAt: agora });
        updated += 1;
      }

      if (updated > 0) {
        await batch.commit();
      }

      return {
        data: { updated },
        message: 'Mensagens marcadas como lidas.',
      };
    } catch (error) {
      if (
        error instanceof BadRequestException ||
        error instanceof NotFoundException
      ) {
        throw error;
      }
      console.error('Erro ao marcar mensagens do posto como lidas:', error);
      throw new InternalServerErrorException(
        'Não foi possível marcar as mensagens como lidas.',
      );
    }
  }

  // --- Inbox do gestor (web-360) — descontinuado: suporte do posto vai ao admin Hora Útil ---

  async listarInboxPrefeitura(
    prefeituraId: string,
    _channelRaw?: unknown,
  ): Promise<{ data: SuporteThreadApi[]; message: string }> {
    const id = prefeituraId.trim();
    if (!id) {
      throw new BadRequestException('prefeituraId inválido.');
    }
    return {
      data: [],
      message:
        'Suporte dos postos é atendido pela equipe Hora Útil no painel admin.',
    };
  }

  async listarMensagensGestor(
    prefeituraId: string,
    postoId: string,
    channelRaw: unknown,
    limitRaw?: number,
    before?: string,
  ): Promise<{
    data: { channel: SuporteChannel; messages: SuporteMensagemApi[] };
    message: string;
  }> {
    const pref = prefeituraId.trim();
    const posto = postoId.trim();
    const channel = parseSuporteChannel(channelRaw);
    const limit = Math.min(Math.max(limitRaw ?? DEFAULT_LIMIT, 1), 100);

    if (!pref) throw new BadRequestException('prefeituraId inválido.');
    if (!posto) throw new BadRequestException('postoId inválido.');

    try {
      const persisted = await this.loadChannelMessagesPosto(posto, channel);
      const page = paginateMensagens(persisted, limit, before);
      const messages = withPostoWelcomeMessages(posto, channel, page);
      return {
        data: { channel, messages },
        message: 'Mensagens carregadas com sucesso.',
      };
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      console.error('Erro ao listar mensagens (gestor):', error);
      throw new InternalServerErrorException(
        'Não foi possível carregar as mensagens.',
      );
    }
  }

  async responderComoGestor(
    prefeituraId: string,
    postoId: string,
    dto: ResponderSuporteDto,
  ): Promise<{ data: SuporteMensagemApi; message: string }> {
    const pref = prefeituraId.trim();
    const posto = postoId.trim();
    const channel = parseSuporteChannel(dto.channel);
    const text = dto.text.trim();

    if (!pref) throw new BadRequestException('prefeituraId inválido.');
    if (!posto) throw new BadRequestException('postoId inválido.');
    if (!text) throw new BadRequestException('text não pode ser vazio.');

    const id = randomUUID();
    const createdAt = new Date().toISOString();
    const payload: SuporteMensagemApi = {
      id,
      postoId: posto,
      prefeituraId: pref,
      channel,
      sender: 'support',
      text,
      createdAt,
      readAt: null,
      autoReply: false,
    };

    try {
      await this.mensagensCollection.doc(id).set(payload);
      return { data: payload, message: 'Resposta enviada com sucesso.' };
    } catch (error) {
      console.error('Erro ao responder mensagem (gestor):', error);
      throw new InternalServerErrorException(
        'Não foi possível enviar a resposta.',
      );
    }
  }

  async marcarLidasAdmin(
    postoId: string,
    channelRaw: unknown,
  ): Promise<{ data: { updated: number }; message: string }> {
    const id = postoId.trim();
    const channel = parseSuporteChannel(channelRaw);

    if (!id) throw new BadRequestException('postoId inválido.');

    try {
      const snap = await this.mensagensCollection
        .where('postoId', '==', id)
        .where('channel', '==', channel)
        .get();

      const agora = new Date().toISOString();
      const batch = this.firebaseService.getFirestore().batch();
      let updated = 0;

      for (const doc of snap.docs) {
        const data = doc.data() as Record<string, unknown>;
        if (texto(data.sender) !== 'user') continue;
        if (data.adminReadAt) continue;

        batch.update(doc.ref, { adminReadAt: agora });
        updated += 1;
      }

      if (updated > 0) await batch.commit();

      return {
        data: { updated },
        message: 'Mensagens do operador marcadas como lidas.',
      };
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      console.error('Erro ao marcar lidas (admin):', error);
      throw new InternalServerErrorException(
        'Não foi possível marcar as mensagens como lidas.',
      );
    }
  }

  // --- Inbox admin Hora Útil (hub mestre) ---

  private async loadMensagensAdminPostos(): Promise<SuporteMensagemApi[]> {
    const snap = await this.mensagensCollection.get();
    const mapa = new Map<string, SuporteMensagemApi>();
    for (const doc of snap.docs) {
      const m = mapMensagemToApi(
        doc.id,
        doc.data() as Record<string, unknown>,
      );
      if (m.postoId) mapa.set(m.id, m);
    }
    return [...mapa.values()];
  }

  async listarInboxAdmin(channelRaw?: unknown): Promise<{
    data: SuporteThreadApi[];
    message: string;
  }> {
    const channelFilter =
      typeof channelRaw === 'string' && channelRaw.trim()
        ? parseSuporteChannel(channelRaw)
        : null;

    try {
      const messages = await this.loadMensagensAdminPostos();
      let threads = agruparThreadsPosto(messages);
      if (channelFilter) {
        threads = threads.filter((t) => t.channel === channelFilter);
      }
      return { data: threads, message: 'Inbox admin carregado com sucesso.' };
    } catch (error) {
      console.error('Erro ao listar inbox admin de suporte:', error);
      throw new InternalServerErrorException(
        'Não foi possível carregar o inbox de suporte.',
      );
    }
  }

  async contarPendentesAdmin(): Promise<{ data: { total: number }; message: string }> {
    const { data } = await this.listarInboxAdmin();
    const total = data.reduce((s, t) => s + t.unreadUserCount, 0);
    return { data: { total }, message: 'ok' };
  }

  async listarMensagensAdmin(
    postoId: string,
    channelRaw: unknown,
    limitRaw?: number,
    before?: string,
  ): Promise<{
    data: { channel: SuporteChannel; messages: SuporteMensagemApi[] };
    message: string;
  }> {
    const posto = postoId.trim();
    const channel = parseSuporteChannel(channelRaw);
    const limit = Math.min(Math.max(limitRaw ?? DEFAULT_LIMIT, 1), 100);

    if (!posto) throw new BadRequestException('postoId inválido.');

    try {
      const persisted = await this.loadChannelMessagesPosto(posto, channel);
      const page = paginateMensagens(persisted, limit, before);
      const messages = withPostoWelcomeMessages(posto, channel, page);
      return {
        data: { channel, messages },
        message: 'Mensagens carregadas com sucesso.',
      };
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      console.error('Erro ao listar mensagens (admin):', error);
      throw new InternalServerErrorException(
        'Não foi possível carregar as mensagens.',
      );
    }
  }

  async responderComoAdmin(
    postoId: string,
    dto: ResponderSuporteDto,
  ): Promise<{ data: SuporteMensagemApi; message: string }> {
    const posto = postoId.trim();
    const channel = parseSuporteChannel(dto.channel);
    const text = dto.text.trim();

    if (!posto) throw new BadRequestException('postoId inválido.');
    if (!text) throw new BadRequestException('text não pode ser vazio.');

    let prefeituraId: string | undefined;
    const postoSnap = await this.postosCollection.doc(posto).get();
    if (postoSnap.exists) {
      prefeituraId =
        texto(postoSnap.data()?.prefeituraId) || undefined;
    }

    const id = randomUUID();
    const createdAt = new Date().toISOString();
    const payload: SuporteMensagemApi = {
      id,
      postoId: posto,
      ...(prefeituraId ? { prefeituraId } : {}),
      channel,
      sender: 'support',
      text,
      createdAt,
      readAt: null,
      autoReply: false,
    };

    try {
      await this.mensagensCollection.doc(id).set(payload);
      return { data: payload, message: 'Resposta enviada com sucesso.' };
    } catch (error) {
      console.error('Erro ao responder mensagem (admin):', error);
      throw new InternalServerErrorException(
        'Não foi possível enviar a resposta.',
      );
    }
  }

  // --- Inbox admin Hora Útil — oficinas (postoapp) ---

  private async loadMensagensAdminOficinas(): Promise<SuporteMensagemApi[]> {
    const snap = await this.mensagensCollection.get();
    const mapa = new Map<string, SuporteMensagemApi>();
    for (const doc of snap.docs) {
      const m = mapMensagemToApi(
        doc.id,
        doc.data() as Record<string, unknown>,
      );
      if (m.oficinaId) mapa.set(m.id, m);
    }
    return [...mapa.values()];
  }

  async listarInboxAdminOficinas(channelRaw?: unknown): Promise<{
    data: SuporteThreadOficinaApi[];
    message: string;
  }> {
    const channelFilter =
      typeof channelRaw === 'string' && channelRaw.trim()
        ? parseSuporteChannel(channelRaw)
        : null;

    try {
      const messages = await this.loadMensagensAdminOficinas();
      let threads = agruparThreadsOficina(messages);
      if (channelFilter) {
        threads = threads.filter((t) => t.channel === channelFilter);
      }
      return {
        data: threads,
        message: 'Inbox admin de oficinas carregado com sucesso.',
      };
    } catch (error) {
      console.error('Erro ao listar inbox admin de oficinas:', error);
      throw new InternalServerErrorException(
        'Não foi possível carregar o inbox de suporte das oficinas.',
      );
    }
  }

  async contarPendentesAdminOficinas(): Promise<{
    data: { total: number };
    message: string;
  }> {
    const { data } = await this.listarInboxAdminOficinas();
    const total = data.reduce((s, t) => s + t.unreadUserCount, 0);
    return { data: { total }, message: 'ok' };
  }

  async listarMensagensAdminOficina(
    oficinaId: string,
    channelRaw: unknown,
    limitRaw?: number,
    before?: string,
  ): Promise<{
    data: { channel: SuporteChannel; messages: SuporteMensagemApi[] };
    message: string;
  }> {
    const id = oficinaId.trim();
    const channel = parseSuporteChannel(channelRaw);
    const limit = Math.min(Math.max(limitRaw ?? DEFAULT_LIMIT, 1), 100);

    if (!id) throw new BadRequestException('oficinaId inválido.');

    try {
      const persisted = await this.loadChannelMessages(id, channel);
      const page = paginateMensagens(persisted, limit, before);
      const messages = withWelcomeMessage(id, channel, page);
      return {
        data: { channel, messages },
        message: 'Mensagens carregadas com sucesso.',
      };
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      console.error('Erro ao listar mensagens admin (oficina):', error);
      throw new InternalServerErrorException(
        'Não foi possível carregar as mensagens.',
      );
    }
  }

  async responderComoAdminOficina(
    oficinaId: string,
    dto: ResponderSuporteDto,
  ): Promise<{ data: SuporteMensagemApi; message: string }> {
    const id = oficinaId.trim();
    const channel = parseSuporteChannel(dto.channel);
    const text = dto.text.trim();

    if (!id) throw new BadRequestException('oficinaId inválido.');
    if (!text) throw new BadRequestException('text não pode ser vazio.');

    await this.assertOficinaExists(id);

    const messageId = randomUUID();
    const createdAt = new Date().toISOString();
    const payload: SuporteMensagemApi = {
      id: messageId,
      oficinaId: id,
      channel,
      sender: 'support',
      text,
      createdAt,
      readAt: null,
      autoReply: false,
    };

    try {
      await this.mensagensCollection.doc(messageId).set(payload);
      return { data: payload, message: 'Resposta enviada com sucesso.' };
    } catch (error) {
      if (
        error instanceof BadRequestException ||
        error instanceof NotFoundException
      ) {
        throw error;
      }
      console.error('Erro ao responder mensagem admin (oficina):', error);
      throw new InternalServerErrorException(
        'Não foi possível enviar a resposta.',
      );
    }
  }

  async marcarLidasAdminOficina(
    oficinaId: string,
    channelRaw: unknown,
  ): Promise<{ data: { updated: number }; message: string }> {
    const id = oficinaId.trim();
    const channel = parseSuporteChannel(channelRaw);

    if (!id) throw new BadRequestException('oficinaId inválido.');

    try {
      const snap = await this.mensagensCollection
        .where('oficinaId', '==', id)
        .where('channel', '==', channel)
        .get();

      const agora = new Date().toISOString();
      const batch = this.firebaseService.getFirestore().batch();
      let updated = 0;

      for (const doc of snap.docs) {
        const data = doc.data() as Record<string, unknown>;
        if (texto(data.sender) !== 'user') continue;
        if (data.adminReadAt) continue;

        batch.update(doc.ref, { adminReadAt: agora });
        updated += 1;
      }

      if (updated > 0) await batch.commit();

      return {
        data: { updated },
        message: 'Mensagens da oficina marcadas como lidas.',
      };
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      console.error('Erro ao marcar lidas admin (oficina):', error);
      throw new InternalServerErrorException(
        'Não foi possível marcar as mensagens como lidas.',
      );
    }
  }
}
