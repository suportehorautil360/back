import type { SuporteChannel, SuporteMensagemApi } from '../suporte.types';
import { welcomeMessageId } from './suporte-channel.helper';

const WELCOME_MESSAGES: Record<SuporteChannel, string> = {
  financeiro:
    'Olá! Aqui você tira dúvidas sobre repasses, notas fiscais e valores de OS. Como posso ajudar?',
  ti: 'Suporte de TI na escuta. Se o sistema travar ou der erro, é só chamar.',
};

const AUTO_REPLIES: Record<SuporteChannel, string> = {
  financeiro:
    'Recebemos sua mensagem. Nossa equipe financeira vai responder em breve.',
  ti: 'Recebemos sua mensagem. A equipe de TI vai analisar e retornar em breve.',
};

const POSTO_AUTO_REPLIES: Record<SuporteChannel, string> = {
  financeiro:
    'Recebemos sua mensagem. A equipe Hora Útil 360 vai responder em breve.',
  ti: 'Recebemos sua mensagem. O suporte Hora Útil 360 vai analisar e retornar em breve.',
};

/** Textos de boas-vindas do chat do posto (posto-web) — suporte Hora Útil. */
const POSTO_WELCOME: Record<SuporteChannel, Array<{ text: string; hour: number; minute: number }>> = {
  financeiro: [
    {
      text: 'Olá! Aqui é o suporte Hora Útil 360. Tire dúvidas sobre notas fiscais, repasses e o portal do posto.',
      hour: 8,
      minute: 14,
    },
    {
      text: 'Horário de atendimento: dias úteis, 8h às 18h. Fora desse horário respondemos no próximo dia útil.',
      hour: 8,
      minute: 15,
    },
  ],
  ti: [
    {
      text: 'Suporte técnico Hora Útil 360. Problemas no sistema, login ou leitura de QR — estamos aqui.',
      hour: 9,
      minute: 2,
    },
  ],
};

function postoWelcomeCreatedAt(hour: number, minute: number): string {
  const d = new Date();
  d.setHours(hour, minute, 0, 0);
  return d.toISOString();
}

export function buildPostoWelcomeMessages(
  postoId: string,
  channel: SuporteChannel,
): SuporteMensagemApi[] {
  return POSTO_WELCOME[channel].map((item, index) => ({
    id: `welcome-${channel}-${index}`,
    postoId,
    channel,
    sender: 'support' as const,
    text: item.text,
    createdAt: postoWelcomeCreatedAt(item.hour, item.minute),
  }));
}

export function buildWelcomeMessage(
  oficinaId: string,
  channel: SuporteChannel,
): SuporteMensagemApi {
  return {
    id: welcomeMessageId(channel),
    oficinaId,
    channel,
    sender: 'support',
    text: WELCOME_MESSAGES[channel],
    createdAt: new Date(0).toISOString(),
  };
}

export function buildAutoReplyMessage(
  oficinaId: string,
  channel: SuporteChannel,
  id: string,
  createdAt: string,
): SuporteMensagemApi {
  return {
    id,
    oficinaId,
    channel,
    sender: 'support',
    text: AUTO_REPLIES[channel],
    createdAt,
  };
}

export function buildAutoReplyForPosto(
  postoId: string,
  channel: SuporteChannel,
  id: string,
  createdAt: string,
): SuporteMensagemApi {
  return {
    id,
    postoId,
    channel,
    sender: 'support',
    text: POSTO_AUTO_REPLIES[channel],
    createdAt,
    autoReply: true,
  };
}
