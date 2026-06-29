import {
  BadRequestException,
  ConflictException,
  UnauthorizedException,
} from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';

import type { FirebaseService } from '../../config/firebase.service';
import { FleetfuelService } from './fleetfuel.service';

/**
 * Teste de integração do fluxo completo do FleetFuel (verificação → intenção →
 * validação) contra um Firestore em memória. Exercita o service real, incluindo
 * a transação de débito de saldo. Roda no Jest/CI sem o emulador do Firebase
 * (que exigiria Java + firebase-tools).
 */

// ---------------------------------------------------------------------------
// Firestore em memória (double) — só o subconjunto da API que o service usa.
// ---------------------------------------------------------------------------

type Doc = Record<string, unknown>;
type Filter = [string, string, unknown];

interface FakeSnap {
  id: string;
  exists: boolean;
  ref: FakeDocRef;
  data: () => Doc | undefined;
}

interface FakeQuerySnap {
  empty: boolean;
  size: number;
  docs: FakeSnap[];
}

class FakeDocRef {
  constructor(
    private readonly db: FakeFirestore,
    private readonly name: string,
    readonly id: string,
  ) {}

  private get coll(): Map<string, Doc> {
    return this.db.collectionStore(this.name);
  }

  get(): Promise<FakeSnap> {
    const data = this.coll.get(this.id);
    return Promise.resolve(makeSnap(this.db, this.name, this.id, data));
  }

  set(data: Doc, opts?: { merge?: boolean }): Promise<void> {
    if (opts?.merge) {
      this.coll.set(this.id, { ...(this.coll.get(this.id) ?? {}), ...data });
    } else {
      this.coll.set(this.id, { ...data });
    }
    return Promise.resolve();
  }

  update(data: Doc): Promise<void> {
    const cur = this.coll.get(this.id);
    if (!cur) return Promise.reject(new Error('doc inexistente'));
    this.coll.set(this.id, { ...cur, ...data });
    return Promise.resolve();
  }
}

function makeSnap(
  db: FakeFirestore,
  name: string,
  id: string,
  data: Doc | undefined,
): FakeSnap {
  return {
    id,
    exists: data !== undefined,
    ref: new FakeDocRef(db, name, id),
    data: () => data,
  };
}

class FakeQuery {
  constructor(
    protected readonly db: FakeFirestore,
    protected readonly name: string,
    protected readonly filters: Filter[] = [],
    protected readonly limitN?: number,
  ) {}

  where(field: string, op: string, value: unknown): FakeQuery {
    return new FakeQuery(
      this.db,
      this.name,
      [...this.filters, [field, op, value]],
      this.limitN,
    );
  }

  limit(n: number): FakeQuery {
    return new FakeQuery(this.db, this.name, this.filters, n);
  }

  get(): Promise<FakeQuerySnap> {
    const coll = this.db.collectionStore(this.name);
    let entries = [...coll.entries()].filter(([, data]) =>
      this.filters.every(([field, , value]) => data[field] === value),
    );
    if (this.limitN != null) entries = entries.slice(0, this.limitN);
    const docs = entries.map(([id, data]) =>
      makeSnap(this.db, this.name, id, data),
    );
    return Promise.resolve({
      empty: docs.length === 0,
      size: docs.length,
      docs,
    });
  }
}

class FakeCollection extends FakeQuery {
  doc(id?: string): FakeDocRef {
    return new FakeDocRef(this.db, this.name, id ?? `auto-${Math.random()}`);
  }
}

interface FakeTx {
  get: (target: { get: () => Promise<unknown> }) => Promise<unknown>;
  set: (ref: FakeDocRef, data: Doc, opts?: { merge?: boolean }) => void;
  update: (ref: FakeDocRef, data: Doc) => void;
}

class FakeFirestore {
  private readonly store = new Map<string, Map<string, Doc>>();

  collectionStore(name: string): Map<string, Doc> {
    let map = this.store.get(name);
    if (!map) {
      map = new Map<string, Doc>();
      this.store.set(name, map);
    }
    return map;
  }

  collection(name: string): FakeCollection {
    this.collectionStore(name);
    return new FakeCollection(this, name);
  }

  seed(name: string, id: string, data: Doc): void {
    this.collectionStore(name).set(id, data);
  }

  runTransaction<T>(fn: (tx: FakeTx) => Promise<T>): Promise<T> {
    const tx: FakeTx = {
      get: (target) => target.get(),
      set: (ref, data, opts) => void ref.set(data, opts),
      update: (ref, data) => void ref.update(data),
    };
    return fn(tx);
  }
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

const PREF = 'pref-1';

function setup(overrides?: {
  equipamento?: Doc;
  operador?: Doc;
  creditoAmount?: number;
}) {
  const db = new FakeFirestore();

  db.seed('equipamentos', 'equip-doc-1', {
    id: 'equip-1',
    prefeituraId: PREF,
    placa: 'BRA2E19',
    modelo: 'Volvo FH',
    descricao: 'Caminhão de coleta',
    combustivel: 'Diesel S-10',
    medicaoAtual: 1000,
    capacidadeTanque: 200,
    intervaloRevisao: 10000,
    ultimaRevisao: 0,
    status: 'ativo',
    ...overrides?.equipamento,
  });

  db.seed('operadores', 'mot-1', {
    prefeituraId: PREF,
    cpf: '12345678900',
    nome: 'Carlos Eduardo Souza',
    cargo: 'Motorista',
    status: 'ativo',
    ...overrides?.operador,
  });

  db.seed('creditos', 'cred-1', {
    type: 'equipment',
    prefeituraId: PREF,
    equipmentId: 'equip-1',
    amount: overrides?.creditoAmount ?? 1000,
  });

  const firebase = {
    getFirestore: () => db,
  } as unknown as FirebaseService;

  const configValues: Record<string, string> = {
    JWT_SECRET: 'segredo-de-teste',
    FLEETFUEL_QR_TTL: '10m',
  };
  const config = {
    get: (key: string) => configValues[key],
  } as unknown as ConfigService;

  const service = new FleetfuelService(firebase, config, new JwtService({}));
  return { service, db };
}

const intencaoBase = {
  prefeituraId: PREF,
  postoId: 'posto-1',
  postoNome: 'Posto Boa Viagem',
  placa: 'BRA2E19',
  kmAtual: 1200,
  cpfMotorista: '12345678900',
  tipoCombustivel: 'Diesel S-10',
  liters: 100,
  pricePerLiter: 6,
};

// ---------------------------------------------------------------------------
// Etapa 1 — verificação
// ---------------------------------------------------------------------------

describe('FleetfuelService.verificar', () => {
  it('libera o veículo e devolve motorista + saldo disponível', async () => {
    const { service } = setup();
    const res = await service.verificar({
      prefeituraId: PREF,
      postoId: 'posto-1',
      placa: 'BRA2E19',
      kmAtual: 1200,
      cpfMotorista: '12345678900',
    });

    expect(res.data.liberado).toBe(true);
    expect(res.data.bloqueio).toBeNull();
    expect(res.data.saldoDisponivel).toBe(1000);
    expect(res.data.veiculo?.placa).toBe('BRA2E19');
    expect(res.data.motorista?.nome).toBe('Carlos Eduardo Souza');
  });

  it('bloqueia quando a placa não existe na empresa', async () => {
    const { service } = setup();
    const res = await service.verificar({
      prefeituraId: PREF,
      postoId: 'posto-1',
      placa: 'XXX0000',
      kmAtual: 1200,
      cpfMotorista: '12345678900',
    });
    expect(res.data.liberado).toBe(false);
    expect(res.data.bloqueio?.codigo).toBe('veiculo_nao_encontrado');
  });

  it('bloqueia por odômetro incoerente (KM menor que o último registro)', async () => {
    const { service } = setup();
    const res = await service.verificar({
      prefeituraId: PREF,
      postoId: 'posto-1',
      placa: 'BRA2E19',
      kmAtual: 500,
      cpfMotorista: '12345678900',
    });
    expect(res.data.liberado).toBe(false);
    expect(res.data.bloqueio?.codigo).toBe('odometro_incoerente');
  });

  it('bloqueia por revisão obrigatória', async () => {
    const { service } = setup({
      equipamento: { ultimaRevisao: 0, intervaloRevisao: 1000 },
    });
    const res = await service.verificar({
      prefeituraId: PREF,
      postoId: 'posto-1',
      placa: 'BRA2E19',
      kmAtual: 1500,
      cpfMotorista: '12345678900',
    });
    expect(res.data.liberado).toBe(false);
    expect(res.data.bloqueio?.codigo).toBe('revisao_obrigatoria');
  });

  it('bloqueia veículo em revisão (status bloqueado)', async () => {
    const { service } = setup({ equipamento: { status: 'bloqueado' } });
    const res = await service.verificar({
      prefeituraId: PREF,
      postoId: 'posto-1',
      placa: 'BRA2E19',
      kmAtual: 1200,
      cpfMotorista: '12345678900',
    });
    expect(res.data.liberado).toBe(false);
    expect(res.data.bloqueio?.codigo).toBe('veiculo_inativo');
  });

  it('bloqueia quando o CPF do motorista não está cadastrado/ativo', async () => {
    const { service } = setup({ operador: { status: 'inativo' } });
    const res = await service.verificar({
      prefeituraId: PREF,
      postoId: 'posto-1',
      placa: 'BRA2E19',
      kmAtual: 1200,
      cpfMotorista: '12345678900',
    });
    expect(res.data.liberado).toBe(false);
    expect(res.data.bloqueio?.codigo).toBe('motorista_nao_encontrado');
  });
});

// ---------------------------------------------------------------------------
// Etapa 2 — intenção / QR
// ---------------------------------------------------------------------------

describe('FleetfuelService.criarIntencao', () => {
  it('gera o token e persiste a intenção pendente', async () => {
    const { service, db } = setup();
    const res = await service.criarIntencao({ ...intencaoBase });

    expect(res.data.token).toBeTruthy();
    expect(res.data.qrConteudo).toBe(`ff:${res.data.intencaoId}`);
    expect(res.data.resumo.total).toBe(600);

    const status = await service.statusIntencao(res.data.intencaoId);
    expect(status.data.status).toBe('pendente_validacao');

    const stored = db
      .collection('fleetfuel_intencoes')
      .doc(res.data.intencaoId);
    const snap = await stored.get();
    expect(snap.exists).toBe(true);
  });

  it('recusa quando o total excede o saldo disponível', async () => {
    const { service } = setup();
    await expect(
      service.criarIntencao({ ...intencaoBase, liters: 200, pricePerLiter: 6 }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('recusa combustível incompatível (veículo Diesel × bomba Gasolina)', async () => {
    const { service } = setup();
    await expect(
      service.criarIntencao({ ...intencaoBase, tipoCombustivel: 'Gasolina' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('recusa litros acima da capacidade do tanque', async () => {
    const { service } = setup();
    await expect(
      service.criarIntencao({
        ...intencaoBase,
        liters: 300,
        pricePerLiter: 1,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

// ---------------------------------------------------------------------------
// Etapa 3 — validação (débito de saldo na transação)
// ---------------------------------------------------------------------------

describe('FleetfuelService.validar', () => {
  it('valida o QR, grava o abastecimento, debita o saldo e conclui', async () => {
    const { service, db } = setup();
    const intencao = await service.criarIntencao({ ...intencaoBase });

    const res = await service.validar({
      token: intencao.data.qrConteudo,
      funcionarioId: 'mot-1',
      cpf: '12345678900',
    });

    expect(res.data.abastecimentoId).toBeTruthy();
    expect(res.data.saldoApos).toBe(400);
    expect(res.data.comprovante.total).toBe(600);

    const abastecimentos = await db.collection('abastecimentos').get();
    expect(abastecimentos.size).toBe(1);
    expect(abastecimentos.docs[0].data()?.total).toBe(600);

    const status = await service.statusIntencao(intencao.data.intencaoId);
    expect(status.data.status).toBe('concluido');
  });

  it('aceita JWT legado na validação', async () => {
    const { service } = setup();
    const intencao = await service.criarIntencao({ ...intencaoBase });

    const res = await service.validar({
      token: intencao.data.token,
      funcionarioId: 'mot-1',
      cpf: '12345678900',
    });

    expect(res.data.abastecimentoId).toBeTruthy();
  });

  it('rejeita token inválido', async () => {
    const { service } = setup();
    await expect(
      service.validar({ token: 'lixo.nao.assinado' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejeita quando o motorista logado não é o da intenção', async () => {
    const { service } = setup();
    const intencao = await service.criarIntencao({ ...intencaoBase });
    await expect(
      service.validar({
        token: intencao.data.token,
        funcionarioId: 'outro-motorista',
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejeita revalidação de um QR já concluído', async () => {
    const { service } = setup();
    const intencao = await service.criarIntencao({ ...intencaoBase });
    await service.validar({
      token: intencao.data.token,
      funcionarioId: 'mot-1',
    });
    await expect(
      service.validar({ token: intencao.data.token, funcionarioId: 'mot-1' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('rejeita e marca como expirado quando a intenção venceu', async () => {
    const { service, db } = setup();
    const intencao = await service.criarIntencao({ ...intencaoBase });

    db.seed('fleetfuel_intencoes', intencao.data.intencaoId, {
      ...(await db
        .collection('fleetfuel_intencoes')
        .doc(intencao.data.intencaoId)
        .get()
        .then((s) => s.data())),
      expiresAt: new Date(Date.now() - 60_000).toISOString(),
    });

    await expect(
      service.validar({ token: intencao.data.token, funcionarioId: 'mot-1' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    const status = await service.statusIntencao(intencao.data.intencaoId);
    expect(status.data.status).toBe('expirado');
  });

  it('rejeita quando o saldo fica insuficiente entre a intenção e a validação', async () => {
    const { service, db } = setup();
    const intencao = await service.criarIntencao({ ...intencaoBase });

    db.seed('abastecimentos', 'gasto-extra', {
      equipmentId: 'equip-1',
      total: 900,
    });

    await expect(
      service.validar({ token: intencao.data.token, funcionarioId: 'mot-1' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
