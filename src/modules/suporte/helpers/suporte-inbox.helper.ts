import { isWelcomeMessageId } from './suporte-channel.helper';
import type {
  SuporteChannel,
  SuporteMensagemApi,
  SuporteSender,
  SuporteThreadApi,
  SuporteThreadOficinaApi,
} from '../suporte.types';

function threadKey(postoId: string, channel: SuporteChannel): string {
  return `${postoId}:${channel}`;
}

function threadKeyOficina(oficinaId: string, channel: SuporteChannel): string {
  return `${oficinaId}:${channel}`;
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

/** Agrupa mensagens persistidas da oficina em threads para o inbox admin. */
export function agruparThreadsOficina(
  messages: SuporteMensagemApi[],
): SuporteThreadOficinaApi[] {
  const grupos = new Map<string, SuporteMensagemApi[]>();

  for (const msg of messages) {
    if (!msg.oficinaId || isWelcomeMessageId(msg.id)) continue;
    const key = threadKeyOficina(msg.oficinaId, msg.channel);
    const lista = grupos.get(key) ?? [];
    lista.push(msg);
    grupos.set(key, lista);
  }

  const threads: SuporteThreadOficinaApi[] = [];

  for (const [key, lista] of grupos) {
    const sorted = [...lista].sort((a, b) =>
      a.createdAt.localeCompare(b.createdAt),
    );
    const last = sorted[sorted.length - 1];
    const [oficinaId, channel] = key.split(':') as [string, SuporteChannel];
    const unreadUserCount = sorted.filter(
      (m) => m.sender === 'user' && !m.adminReadAt,
    ).length;

    threads.push({
      oficinaId,
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
