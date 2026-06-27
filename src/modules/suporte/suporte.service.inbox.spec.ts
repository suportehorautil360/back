import type { FirebaseService } from '../../config/firebase.service';
import { SuporteService } from './suporte.service';

type Doc = Record<string, unknown>;

class FakeDocRef {
  constructor(
    private readonly coll: Map<string, Doc>,
    readonly id: string,
  ) {}
  get() {
    const data = this.coll.get(this.id);
    return Promise.resolve({
      id: this.id,
      exists: data !== undefined,
      data: () => data,
    });
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
    protected filters: Array<[string, unknown, string?]> = [],
  ) {}
  where(field: string, op: string, value: unknown): FakeQuery {
    return new FakeQuery(this.coll, [...this.filters, [field, value, op]]);
  }
  get() {
    const docs = [...this.coll.entries()]
      .filter(([, data]) =>
        this.filters.every(([f, v, op]) => {
          if (op === 'in' && Array.isArray(v)) {
            return (v as unknown[]).includes(data[f]);
          }
          return data[f] === v;
        }),
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

describe('SuporteService — inbox admin Hora Útil', () => {
  it('lista threads com mensagens não lidas pelo admin', async () => {
    const { service } = makeService();
    await service.enviarMensagemPosto('posto-1', {
      postoId: 'posto-1',
      channel: 'financeiro',
      text: 'Dúvida NF',
      prefeituraId: 'pref-1',
    });

    const { data } = await service.listarInboxAdmin();
    expect(data.length).toBe(1);
    expect(data[0].postoId).toBe('posto-1');
    expect(data[0].channel).toBe('financeiro');
    expect(data[0].unreadUserCount).toBe(1);
  });

  it('inbox da prefeitura fica vazio (suporte vai ao admin)', async () => {
    const { service } = makeService();
    await service.enviarMensagemPosto('posto-1', {
      postoId: 'posto-1',
      channel: 'financeiro',
      text: 'Dúvida NF',
      prefeituraId: 'pref-1',
    });

    const { data } = await service.listarInboxPrefeitura('pref-1');
    expect(data).toHaveLength(0);
  });

  it('filtra inbox admin por canal', async () => {
    const { service } = makeService();
    await service.enviarMensagemPosto('posto-1', {
      postoId: 'posto-1',
      channel: 'financeiro',
      text: 'NF',
      prefeituraId: 'pref-1',
    });
    await service.enviarMensagemPosto('posto-1', {
      postoId: 'posto-1',
      channel: 'ti',
      text: 'QR',
      prefeituraId: 'pref-1',
    });

    const { data } = await service.listarInboxAdmin('ti');
    expect(data).toHaveLength(1);
    expect(data[0].channel).toBe('ti');
  });

  it('marca mensagens do operador como lidas pelo admin', async () => {
    const { service } = makeService();
    await service.enviarMensagemPosto('posto-1', {
      postoId: 'posto-1',
      channel: 'ti',
      text: 'Problema',
      prefeituraId: 'pref-1',
    });

    const antes = await service.listarInboxAdmin();
    expect(antes.data[0].unreadUserCount).toBe(1);

    await service.marcarLidasAdmin('posto-1', 'ti');

    const depois = await service.listarInboxAdmin();
    expect(depois.data[0].unreadUserCount).toBe(0);
  });

  it('admin responde sem autoReply', async () => {
    const { service, store } = makeService();
    const { data } = await service.responderComoAdmin('posto-1', {
      channel: 'financeiro',
      text: 'Resposta humana',
    });

    expect(data.autoReply).toBe(false);
    expect(data.sender).toBe('support');
    expect(data.text).toBe('Resposta humana');
    expect(store.has(data.id)).toBe(true);
  });
});
