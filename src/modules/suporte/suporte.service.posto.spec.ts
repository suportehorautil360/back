import { BadRequestException } from '@nestjs/common';

import type { FirebaseService } from '../../config/firebase.service';
import { SuporteService } from './suporte.service';
import * as welcomeHelper from './helpers/suporte-welcome.helper';

type Doc = Record<string, unknown>;

class FakeDocRef {
  constructor(
    private readonly coll: Map<string, Doc>,
    readonly id: string,
  ) {}
  get() {
    const data = this.coll.get(this.id);
    return Promise.resolve({ id: this.id, exists: data !== undefined, data: () => data });
  }
  set(data: Doc) {
    this.coll.set(this.id, { ...data });
    return Promise.resolve();
  }
  update(patch: Doc) {
    const cur = this.coll.get(this.id);
    if (!cur) return Promise.reject(new Error('doc inexistente'));
    this.coll.set(this.id, { ...cur, ...patch });
    return Promise.resolve();
  }
}

class FakeQuery {
  constructor(
    protected coll: Map<string, Doc>,
    protected filters: Array<[string, unknown]> = [],
  ) {}
  where(field: string, _op: string, value: unknown): FakeQuery {
    return new FakeQuery(this.coll, [...this.filters, [field, value]]);
  }
  get() {
    const docs = [...this.coll.entries()]
      .filter(([, data]) =>
        this.filters.every(([f, v]) => data[f] === v),
      )
      .map(([id, data]) => ({
        id,
        data: () => data,
        ref: new FakeDocRef(this.coll, id),
      }));
    return Promise.resolve({ empty: docs.length === 0, docs });
  }
}

class FakeCollection extends FakeQuery {
  doc(id?: string): FakeDocRef {
    return new FakeDocRef(this.coll, id ?? `auto-${Math.random()}`);
  }
}

function makeService() {
  const store = new Map<string, Doc>();
  const batchOps: Array<{ type: string; id: string; data: Doc }> = [];
  const firebase = {
    getFirestore: () => ({
      collection: () => new FakeCollection(store),
      batch: () => ({
        set: (ref: FakeDocRef, data: Doc) => {
          batchOps.push({ type: 'set', id: ref.id, data });
        },
        update: (ref: FakeDocRef, data: Doc) => {
          const cur = store.get(ref.id) ?? {};
          batchOps.push({ type: 'set', id: ref.id, data: { ...cur, ...data } });
        },
        commit: async () => {
          for (const op of batchOps) {
            store.set(op.id, op.data);
          }
          batchOps.length = 0;
        },
      }),
    }),
  } as unknown as FirebaseService;
  return { service: new SuporteService(firebase), store };
}

describe('SuporteService — fluxo do posto', () => {
  it('lista mensagens com boas-vindas do posto', async () => {
    const { service } = makeService();
    const { data } = await service.listarMensagensPosto('posto-1', 'financeiro');
    expect(data.messages.length).toBeGreaterThanOrEqual(2);
    expect(data.messages[0].sender).toBe('support');
    expect(data.messages[0].text).toContain('setor financeiro');
  });

  it('envia mensagem e grava user + auto-resposta', async () => {
    const { service, store } = makeService();
    await service.enviarMensagemPosto('posto-1', {
      postoId: 'posto-1',
      channel: 'ti',
      text: 'QR não lê',
    });
    const docs = [...store.values()];
    expect(docs).toHaveLength(2);
    expect(docs.some((d) => d.sender === 'user' && d.text === 'QR não lê')).toBe(true);
    expect(docs.some((d) => d.sender === 'support')).toBe(true);
  });

  it('resumo conta support não lidas', async () => {
    const { service } = makeService();
    await service.enviarMensagemPosto('posto-1', {
      postoId: 'posto-1',
      channel: 'ti',
      text: 'teste',
    });
    const { data } = await service.obterResumoPosto('posto-1');
    expect(data.unreadCount).toBeGreaterThanOrEqual(1);
  });

  it('marcar lidas zera unread do canal', async () => {
    const { service } = makeService();
    await service.enviarMensagemPosto('posto-1', {
      postoId: 'posto-1',
      channel: 'financeiro',
      text: 'dúvida',
    });
    await service.marcarComoLidasPosto('posto-1', 'financeiro');
    const { data } = await service.obterResumoPosto('posto-1');
    expect(data.channels.financeiro.unreadCount).toBe(0);
  });

  it('rejeita postoId divergente no body', async () => {
    const { service } = makeService();
    await expect(
      service.enviarMensagemPosto('posto-1', {
        postoId: 'outro',
        channel: 'ti',
        text: 'x',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('buildPostoWelcomeMessages', () => {
  it('financeiro tem duas mensagens', () => {
    const msgs = welcomeHelper.buildPostoWelcomeMessages('p1', 'financeiro');
    expect(msgs).toHaveLength(2);
    expect(msgs[1].text).toContain('R$ 500');
  });
});
