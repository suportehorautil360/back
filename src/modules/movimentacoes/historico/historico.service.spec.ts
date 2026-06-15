import { HistoricoService } from './historico.service';
import type { FirebaseService } from '../../../config/firebase.service';

type Row = Record<string, unknown>;

/** Collection fake: `.where().get()` e `.doc().get()` para o service. */
function fakeCol(rows: Row[]) {
  const snap = {
    docs: rows.map((r) => ({
      id: typeof r.id === 'string' ? r.id : '',
      data: () => r,
    })),
  };
  const get = () => Promise.resolve(snap);
  const where = () => ({ where, get });
  const doc = () => ({
    get: () => Promise.resolve({ exists: false, data: () => undefined }),
  });
  return { where, get, doc };
}

function service(cols: Record<string, ReturnType<typeof fakeCol>>) {
  const firebase = {
    getFirestore: () => ({
      collection: (name: string) => cols[name] ?? fakeCol([]),
    }),
  } as unknown as FirebaseService;
  return new HistoricoService(firebase);
}

describe('HistoricoService.listarPorPrefeitura', () => {
  it('não quebra com doc sem createdAt e o exclui do histórico', async () => {
    const hoje = new Date().toISOString();
    const svc = service({
      abastecimentos: fakeCol([
        {
          id: 'a1',
          createdAt: hoje,
          liters: 10,
          equipmentId: 'e1',
          plateOrChassis: 'ABC-1234',
          measurementType: 'horimetro',
          currentReading: 100,
        },
        { id: 'a2', liters: 5 }, // legado: sem createdAt
      ]),
      lubrificacoes: fakeCol([]),
      reabastecimentos: fakeCol([]),
      equipamentos: fakeCol([
        { id: 'e1', descricao: 'Escavadeira', placa: 'ABC-1234' },
      ]),
    });

    const r = await svc.listarPorPrefeitura('pref-1');

    // Só o doc datado entra no resumo e nos grupos; o sem createdAt é ignorado.
    expect(r.summary.totalAbastecimentosToday).toBe(1);
    expect(r.summary.totalLitersToday).toBe(10);
    const ids = r.groups.flatMap((g) => g.items.map((i) => i.id));
    expect(ids).toEqual(['a1']);
  });
});
