import { fetchPrefeituraDocs } from './prefeitura-query.helper';

/** Collection fake: `.where().get()` devolve os rows como docs do Firestore. */
function fakeCollection(rows: Record<string, unknown>[]): never {
  return {
    where: () => ({
      get: () =>
        Promise.resolve({ docs: rows.map((r) => ({ data: () => r })) }),
    }),
  } as never;
}

describe('fetchPrefeituraDocs', () => {
  it('não quebra quando um doc está sem createdAt e ordena o resto (desc)', async () => {
    const col = fakeCollection([
      { createdAt: '2026-06-01T10:00:00.000Z' },
      {}, // doc legado sem createdAt
      { createdAt: '2026-06-03T10:00:00.000Z' },
    ]);

    const r = await fetchPrefeituraDocs<{ createdAt: string }>(col, 'pref-1');

    expect(r).toHaveLength(3);
    // desc: mais novo primeiro; o doc sem createdAt ('') vai para o fim.
    expect(r[0].createdAt).toBe('2026-06-03T10:00:00.000Z');
    expect(r[1].createdAt).toBe('2026-06-01T10:00:00.000Z');
    expect(r[2].createdAt).toBeUndefined();
  });

  it('ordena asc quando pedido', async () => {
    const col = fakeCollection([
      { createdAt: '2026-06-03T10:00:00.000Z' },
      { createdAt: '2026-06-01T10:00:00.000Z' },
    ]);

    const r = await fetchPrefeituraDocs<{ createdAt: string }>(col, 'pref-1', {
      order: 'asc',
    });

    expect(r[0].createdAt).toBe('2026-06-01T10:00:00.000Z');
    expect(r[1].createdAt).toBe('2026-06-03T10:00:00.000Z');
  });
});
