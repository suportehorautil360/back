import type { CollectionReference } from 'firebase-admin/firestore';

export function parseNumeroDevolucaoSeq(
  number: string,
  year: number,
): number | null {
  const m = new RegExp(`^CHD-${year}-(\\d+)$`, 'i').exec(number.trim());
  if (!m) return null;
  const seq = Number(m[1]);
  return Number.isFinite(seq) ? seq : null;
}

export function formatNumeroDevolucao(year: number, seq: number): string {
  return `CHD-${year}-${String(seq).padStart(4, '0')}`;
}

/** Próximo número CHD-{ano}-{seq} por oficina. */
export async function nextNumeroDevolucao(
  collection: CollectionReference,
  oficinaId: string,
  year = new Date().getFullYear(),
): Promise<string> {
  const snap = await collection.where('oficinaId', '==', oficinaId).get();

  let maxSeq = 0;
  for (const doc of snap.docs) {
    const numero = String(doc.data().number ?? '');
    const seq = parseNumeroDevolucaoSeq(numero, year);
    if (seq !== null && seq > maxSeq) maxSeq = seq;
  }

  return formatNumeroDevolucao(year, maxSeq + 1);
}
