/**
 * Auth state do Baileys persistido no Postgres/Supabase (equivalente ao
 * `useMultiFileAuthState`, sem disco local).
 *
 * Singleton em `whatsapp_platform_sessions` (`id = default`): `creds` e `keys`
 * serializados via `BufferJSON` (lida com Buffers).
 */
import type {
  AuthenticationCreds,
  AuthenticationState,
} from '@whiskeysockets/baileys';
import type { PrismaService } from '../../prisma/prisma.service';

export const WHATSAPP_PLATFORM_SESSION_ID = 'default';

export interface PrismaAuthState {
  state: AuthenticationState;
  saveCreds: () => Promise<void>;
  clear: () => Promise<void>;
}

export async function usePrismaAuthState(
  prisma: PrismaService,
  sessionId = WHATSAPP_PLATFORM_SESSION_ID,
): Promise<PrismaAuthState> {
  const { initAuthCreds, BufferJSON, proto } = await import(
    '@whiskeysockets/baileys'
  );

  const row = await prisma.whatsappPlatformSession.findUnique({
    where: { id: sessionId },
  });

  const creds: AuthenticationCreds = row?.creds
    ? (JSON.parse(row.creds, BufferJSON.reviver) as AuthenticationCreds)
    : initAuthCreds();
  const keys: Record<string, unknown> = row?.keys
    ? (JSON.parse(row.keys, BufferJSON.reviver) as Record<string, unknown>)
    : {};

  const persist = async () => {
    await prisma.whatsappPlatformSession.upsert({
      where: { id: sessionId },
      create: {
        id: sessionId,
        creds: JSON.stringify(creds, BufferJSON.replacer),
        keys: JSON.stringify(keys, BufferJSON.replacer),
      },
      update: {
        creds: JSON.stringify(creds, BufferJSON.replacer),
        keys: JSON.stringify(keys, BufferJSON.replacer),
      },
    });
  };

  const keyStore = {
    get: (type: string, ids: string[]) => {
      const out: Record<string, unknown> = {};
      for (const id of ids) {
        let value = keys[`${type}-${id}`];
        if (type === 'app-state-sync-key' && value) {
          value = proto.Message.AppStateSyncKeyData.fromObject(value);
        }
        out[id] = value;
      }
      return out;
    },
    set: async (data: Record<string, Record<string, unknown>>) => {
      for (const type of Object.keys(data)) {
        for (const id of Object.keys(data[type])) {
          const value = data[type][id];
          const k = `${type}-${id}`;
          if (value) keys[k] = value;
          else delete keys[k];
        }
      }
      await persist();
    },
  };

  return {
    state: {
      creds,
      keys: keyStore as unknown as AuthenticationState['keys'],
    },
    saveCreds: persist,
    clear: async () => {
      await prisma.whatsappPlatformSession.deleteMany({
        where: { id: sessionId },
      });
    },
  };
}
