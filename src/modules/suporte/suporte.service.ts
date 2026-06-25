import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { FirebaseService } from '../../config/firebase.service';
import type { CreateMensagemSuporteDto } from './dto/create-mensagem.dto';
import { parseSuporteChannel } from './helpers/suporte-channel.helper';
import {
  paginateMensagens,
  withWelcomeMessage,
} from './helpers/suporte-mensagens.helper';
import { mapMensagemToApi } from './helpers/suporte-response.helper';
import { buildAutoReplyMessage } from './helpers/suporte-welcome.helper';
import type {
  SuporteChannel,
  SuporteMensagemApi,
  SuporteResumoApi,
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

    const userMessageId = randomUUID();
    const autoReplyId = randomUUID();
    const userCreatedAt = new Date().toISOString();
    const autoReplyCreatedAt = new Date(
      Date.now() + 1000,
    ).toISOString();

    const userMessage: SuporteMensagemApi = {
      id: userMessageId,
      oficinaId: id,
      channel,
      sender: 'user',
      text,
      createdAt: userCreatedAt,
      readAt: null,
    };

    const autoReply = buildAutoReplyMessage(
      id,
      channel,
      autoReplyId,
      autoReplyCreatedAt,
    );

    try {
      const batch = this.firebaseService.getFirestore().batch();
      const userRef = this.mensagensCollection.doc(userMessageId);
      const replyRef = this.mensagensCollection.doc(autoReplyId);

      batch.set(userRef, {
        ...userMessage,
        ...(context?.parceiroId ? { parceiroId: context.parceiroId } : {}),
        ...(context?.prefeituraId ? { prefeituraId: context.prefeituraId } : {}),
      });

      batch.set(replyRef, {
        ...autoReply,
        readAt: null,
      });

      await batch.commit();

      return {
        data: {
          message: userMessage,
          messages: [userMessage, autoReply],
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
}
