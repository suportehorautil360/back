import { CollectionReference, Query } from 'firebase-admin/firestore';
import { parseDateEnd, parseDateStart } from './date.helper';

export interface PrefeituraQueryOptions {
  startDate?: string;
  endDate?: string;
  order?: 'asc' | 'desc';
  limit?: number;
}

/** Normaliza createdAt / criadoEm (string ISO, Timestamp Firestore ou legado). */
export function createdAtToIso(raw: unknown): string {
  if (!raw) return '';
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) return '';
    // Campo legado `data` (YYYY-MM-DD) — meio-dia UTC para cair no dia certo.
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
      return `${trimmed}T12:00:00.000Z`;
    }
    const d = new Date(trimmed);
    return Number.isNaN(d.getTime()) ? '' : d.toISOString();
  }

  if (typeof raw === 'object' && raw !== null) {
    const rec = raw as Record<string, unknown>;
    if (typeof rec.toDate === 'function') {
      const date = (rec.toDate as () => Date)();
      return Number.isNaN(date.getTime()) ? '' : date.toISOString();
    }
    if (typeof rec.seconds === 'number') {
      return new Date(rec.seconds * 1000).toISOString();
    }
    if (typeof rec._seconds === 'number') {
      return new Date(rec._seconds * 1000).toISOString();
    }
  }

  return '';
}

/** createdAt → criadoEm → data (YYYY-MM-DD do portal legado). */
export function resolveCreatedAt(data: Record<string, unknown>): string {
  return (
    createdAtToIso(data.createdAt) ||
    createdAtToIso(data.criadoEm) ||
    createdAtToIso(data.data)
  );
}

function compareCreatedAt(
  a: string,
  b: string,
  order: 'asc' | 'desc',
): number {
  if (!a && !b) return 0;
  if (!a) return 1;
  if (!b) return -1;
  const diff = a.localeCompare(b);
  return order === 'desc' ? -diff : diff;
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

  let items = snap.docs.map((doc) => {
    const data = doc.data() as Record<string, unknown>;
    return {
      ...data,
      createdAt: resolveCreatedAt(data),
    } as T;
  });

  if (options.startDate) {
    const startIso = parseDateStart(
      options.startDate,
      'startDate',
    ).toISOString();
    items = items.filter((item) => item.createdAt && item.createdAt >= startIso);
  }

  if (options.endDate) {
    const endIso = parseDateEnd(options.endDate, 'endDate').toISOString();
    items = items.filter((item) => item.createdAt && item.createdAt <= endIso);
  }

  const order = options.order ?? 'desc';
  // Tolera doc legado/incompleto sem `createdAt` (compareCreatedAt joga vazios pro fim).
  items.sort((a, b) => compareCreatedAt(a.createdAt, b.createdAt, order));

  if (options.limit !== undefined && options.limit > 0) {
    items = items.slice(0, options.limit);
  }

  return items;
}
