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
