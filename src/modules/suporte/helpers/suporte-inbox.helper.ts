import { isWelcomeMessageId } from './suporte-channel.helper';
import type {
  SuporteChannel,
  SuporteMensagemApi,
  SuporteSender,
  SuporteThreadApi,
} from '../suporte.types';

function threadKey(postoId: string, channel: SuporteChannel): string {
  return `${postoId}:${channel}`;
}

/** Agrupa mensagens persistidas do posto em threads para o inbox do gestor. */
export function agruparThreadsPosto(
  messages: SuporteMensagemApi[],
): SuporteThreadApi[] {
  const grupos = new Map<string, SuporteMensagemApi[]>();

  for (const msg of messages) {
    if (!msg.postoId || isWelcomeMessageId(msg.id)) continue;
    const key = threadKey(msg.postoId, msg.channel);
    const lista = grupos.get(key) ?? [];
    lista.push(msg);
    grupos.set(key, lista);
  }

  const threads: SuporteThreadApi[] = [];

  for (const [key, lista] of grupos) {
    const sorted = [...lista].sort((a, b) =>
      a.createdAt.localeCompare(b.createdAt),
    );
    const last = sorted[sorted.length - 1];
    const [postoId, channel] = key.split(':') as [string, SuporteChannel];
    const unreadUserCount = sorted.filter(
      (m) => m.sender === 'user' && !m.adminReadAt,
    ).length;

    threads.push({
      postoId,
      channel,
      lastMessage: last.text,
      lastMessageAt: last.createdAt,
      lastSender: last.sender as SuporteSender,
      unreadUserCount,
    });
  }

  return threads.sort((a, b) =>
    b.lastMessageAt.localeCompare(a.lastMessageAt),
  );
}
