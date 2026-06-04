/**
 * Auth state do Baileys persistido no Firestore (equivalente ao
 * `useMultiFileAuthState`, mas sem disco — sobrevive a redeploy no Railway).
 *
 * Guarda tudo num doc só (`whatsappSessions/default`): `creds` e `keys`
 * serializados via `BufferJSON` (lida com Buffers). Para um remetente único de
 * notificações o volume de chaves é pequeno; se um dia crescer (limite de 1MB
 * por doc no Firestore), dá para shardar as chaves em subcoleção.
 *
 * Baileys 7 é ESM-only e o backend é CommonJS, então os VALORES vêm por
 * `import()` dinâmico; os TIPOS por `import type` (somem na compilação).
 */
import type {
  AuthenticationCreds,
  AuthenticationState,
} from '@whiskeysockets/baileys';

export interface FirestoreAuthState {
  state: AuthenticationState;
  saveCreds: () => Promise<void>;
  clear: () => Promise<void>;
}

export async function useFirestoreAuthState(
  docRef: FirebaseFirestore.DocumentReference,
): Promise<FirestoreAuthState> {
  const { initAuthCreds, BufferJSON, proto } = await import(
    '@whiskeysockets/baileys'
  );

  const snap = await docRef.get();
  const data = snap.exists
    ? (snap.data() as { creds?: string; keys?: string })
    : {};

  const creds: AuthenticationCreds = data.creds
    ? (JSON.parse(data.creds, BufferJSON.reviver) as AuthenticationCreds)
    : initAuthCreds();
  const keys: Record<string, unknown> = data.keys
    ? (JSON.parse(data.keys, BufferJSON.reviver) as Record<string, unknown>)
    : {};

  const persist = async () => {
    await docRef.set(
      {
        creds: JSON.stringify(creds, BufferJSON.replacer),
        keys: JSON.stringify(keys, BufferJSON.replacer),
        atualizadoEm: new Date().toISOString(),
      },
      { merge: true },
    );
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
      await docRef.delete();
    },
  };
}
