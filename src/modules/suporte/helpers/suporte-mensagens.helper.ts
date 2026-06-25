import type { SuporteMensagemApi } from '../suporte.types';
import { buildWelcomeMessage } from './suporte-welcome.helper';
import { isWelcomeMessageId } from './suporte-channel.helper';
import type { SuporteChannel } from '../suporte.types';

export function paginateMensagens(
  messages: SuporteMensagemApi[],
  limit: number,
  before?: string,
): SuporteMensagemApi[] {
  const persisted = messages
    .filter((message) => !isWelcomeMessageId(message.id))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  let slice = persisted;

  if (before) {
    slice = slice.filter((message) => message.createdAt < before);
    if (slice.length > limit) {
      slice = slice.slice(slice.length - limit);
    }
  } else if (slice.length > limit) {
    slice = slice.slice(slice.length - limit);
  }

  return slice;
}

export function withWelcomeMessage(
  oficinaId: string,
  channel: SuporteChannel,
  messages: SuporteMensagemApi[],
): SuporteMensagemApi[] {
  const welcome = buildWelcomeMessage(oficinaId, channel);
  const withoutWelcome = messages.filter(
    (message) => !isWelcomeMessageId(message.id),
  );

  if (withoutWelcome.length === 0) {
    return [welcome];
  }

  return [welcome, ...withoutWelcome];
}
