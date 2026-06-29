import type { FirebaseService } from '../../../config/firebase.service';
import { ConsumoCustoService } from './consumo-custo.service';

type Doc = Record<string, unknown>;
type Filter = [string, string, unknown];

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
}

class FakeQuery {
  constructor(
    protected coll: Map<string, Doc>,
    protected filters: Filter[] = [],
  ) {}

  where(field: string, op: string, value: unknown): FakeQuery {
    return new FakeQuery(this.coll, [...this.filters, [field, op, value]]);
  }

  get() {
    const docs = [...this.coll.entries()]
      .filter(([, data]) =>
        this.filters.every(([f, op, v]) => {
          if (op === '==') return data[f] === v;
          if (op === 'in') {
            return Array.isArray(v) && v.includes(data[f]);
          }
          return true;
        }),
      )
      .map(([id, data]) => ({ id, data: () => data }));
    return Promise.resolve({ empty: docs.length === 0, docs });
  }
}

class FakeCollection extends FakeQuery {
  doc(id?: string): FakeDocRef {
    return new FakeDocRef(this.coll, id ?? `auto-${Math.random()}`);
  }
}

function makeService(stores: {
  abastecimentos: Map<string, Doc>;
  equipamentos: Map<string, Doc>;
}) {
  const firebase = {
    getFirestore: () => ({
      collection: (name: string) => {
        if (name === 'abastecimentos') {
          return new FakeCollection(stores.abastecimentos);
        }
        if (name === 'equipamentos') {
          return new FakeCollection(stores.equipamentos);
        }
        throw new Error(`coleção inesperada: ${name}`);
      },
    }),
  } as unknown as FirebaseService;

  return new ConsumoCustoService(firebase);
}

describe('ConsumoCustoService (integração spec V2)', () => {
  it('Caso 1 PDF: GET agregado — 45 L / 300 km @ R$ 5,99/l', async () => {
    const abastecimentos = new Map<string, Doc>([
      [
        'ab0',
        {
          prefeituraId: 'pref-1',
          equipmentId: 'eq-1',
          liters: 0,
          currentReading: 0,
          measurementType: 'hodometro',
          createdAt: '2026-06-01T08:00:00.000Z',
        },
      ],
      [
        'ab1',
        {
          prefeituraId: 'pref-1',
          equipmentId: 'eq-1',
          liters: 45,
          currentReading: 300,
          measurementType: 'hodometro',
          pricePerLiter: 5.99,
          createdAt: '2026-06-15T12:00:00.000Z',
        },
      ],
    ]);

    const equipamentos = new Map<string, Doc>([
      [
        'eq-1',
        {
          id: 'eq-1',
          descricao: 'Frota Teste',
          unidadeRevisao: 'km',
        },
      ],
    ]);

    const service = makeService({ abastecimentos, equipamentos });
    const { data } = await service.listarPorPrefeitura(
      'pref-1',
      '2026-06-01',
      '2026-06-30',
    );

    expect(data.veiculos).toHaveLength(1);
    const card = data.veiculos[0];
    expect(card.unidadeMedicao).toBe('km');
    expect(card.consumoMedio.valor).toBeCloseTo(0.15, 4);
    expect(card.custoMedio.valor).toBeCloseTo(0.8985, 3);
    expect(card.totais.gasto).toBeCloseTo(269.55, 2);
    expect(card.temCusto).toBe(true);
  });

  it('Caso 2 PDF: tanque cheio em campo — 350 L / 8 h, sem custo', async () => {
    const abastecimentos = new Map<string, Doc>([
      [
        'ab0',
        {
          prefeituraId: 'pref-1',
          equipmentId: 'eq-2',
          liters: 400,
          currentReading: 1000,
          measurementType: 'horimetro',
          createdAt: '2026-06-01T08:00:00.000Z',
        },
      ],
      [
        'ab1',
        {
          prefeituraId: 'pref-1',
          equipmentId: 'eq-2',
          liters: 350,
          currentReading: 1008,
          measurementType: 'horimetro',
          createdAt: '2026-06-02T18:00:00.000Z',
        },
      ],
    ]);

    const equipamentos = new Map<string, Doc>([
      [
        'eq-2',
        {
          id: 'eq-2',
          descricao: 'Escavadeira',
          unidadeRevisao: 'h',
        },
      ],
    ]);

    const service = makeService({ abastecimentos, equipamentos });
    const { data } = await service.listarPorPrefeitura(
      'pref-1',
      '2026-06-01',
      '2026-06-30',
    );

    const card = data.veiculos[0];
    expect(card.unidadeMedicao).toBe('h');
    expect(card.consumoMedio.valor).toBeCloseTo(43.75, 2);
    expect(card.custoMedio.valor).toBeNull();
    expect(card.temCusto).toBe(false);
    expect(card.totais.litros).toBe(350);
    expect(card.totalDestaque.tipo).toBe('litros');
  });
});
