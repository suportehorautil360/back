import { createdAtToIso, fetchPrefeituraDocs } from './prefeitura-query.helper';

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
    // desc: mais novo primeiro; o doc sem createdAt vai para o fim.
    // resolveCreatedAt normaliza ausência para '' (não undefined).
    expect(r[0].createdAt).toBe('2026-06-03T10:00:00.000Z');
    expect(r[1].createdAt).toBe('2026-06-01T10:00:00.000Z');
    expect(r[2].createdAt).toBe('');
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

describe('createdAtToIso', () => {
  it('retorna string ISO quando já é string', () => {
    expect(createdAtToIso('2026-06-01T10:00:00.000Z')).toBe(
      '2026-06-01T10:00:00.000Z',
    );
  });

  it('converte Timestamp-like com toDate', () => {
    const iso = createdAtToIso({
      toDate: () => new Date('2026-06-02T12:00:00.000Z'),
    });
    expect(iso).toBe('2026-06-02T12:00:00.000Z');
  });

  it('converte objeto com seconds', () => {
    const iso = createdAtToIso({ seconds: 1749136200 });
    expect(iso).toBe(new Date(1749136200 * 1000).toISOString());
  });

  it('retorna vazio para undefined', () => {
    expect(createdAtToIso(undefined)).toBe('');
    expect(createdAtToIso(null)).toBe('');
  });
});

describe('compareCreatedAt (sort seguro)', () => {
  function sort(
    items: string[],
    order: 'asc' | 'desc' = 'desc',
  ): string[] {
    return [...items].sort((a, b) => {
      if (!a && !b) return 0;
      if (!a) return 1;
      if (!b) return -1;
      const diff = a.localeCompare(b);
      return order === 'desc' ? -diff : diff;
    });
  }

  it('não quebra com string vazia no meio', () => {
    const sorted = sort([
      '2026-06-01T10:00:00.000Z',
      '',
      '2026-06-03T10:00:00.000Z',
    ]);
    expect(sorted[0]).toBe('2026-06-03T10:00:00.000Z');
    expect(sorted[2]).toBe('');
  });
});
