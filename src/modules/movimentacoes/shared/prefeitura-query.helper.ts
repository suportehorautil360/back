import { CollectionReference, Query } from 'firebase-admin/firestore';
import { parseDateEnd, parseDateStart } from './date.helper';

export interface PrefeituraQueryOptions {
  startDate?: string;
  endDate?: string;
  order?: 'asc' | 'desc';
  limit?: number;
}

/**
 * Busca documentos por prefeitura sem orderBy/range no Firestore,
 * evitando índices compostos. Filtro de datas e ordenação ficam em memória.
 */
export async function fetchPrefeituraDocs<T extends { createdAt: string }>(
  collection: CollectionReference | Query,
  prefeituraId: string,
  options: PrefeituraQueryOptions = {},
): Promise<T[]> {
  const snap = await collection.where('prefeituraId', '==', prefeituraId).get();

  let items = snap.docs.map((doc) => doc.data() as T);

  if (options.startDate) {
    const startIso = parseDateStart(
      options.startDate,
      'startDate',
    ).toISOString();
    items = items.filter((item) => item.createdAt >= startIso);
  }

  if (options.endDate) {
    const endIso = parseDateEnd(options.endDate, 'endDate').toISOString();
    items = items.filter((item) => item.createdAt <= endIso);
  }

  const order = options.order ?? 'desc';
  // Tolera doc legado/incompleto sem `createdAt` (evita quebrar o sort/endpoint).
  items.sort((a, b) => {
    const diff = (a.createdAt ?? '').localeCompare(b.createdAt ?? '');
    return order === 'desc' ? -diff : diff;
  });

  if (options.limit !== undefined && options.limit > 0) {
    items = items.slice(0, options.limit);
  }

  return items;
}
