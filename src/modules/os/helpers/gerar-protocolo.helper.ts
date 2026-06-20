import type { CollectionReference } from 'firebase-admin/firestore';

export function parseProtocolSeq(
  protocolo: string,
  year: number,
): number | null {
  const m = new RegExp(`^OS-${year}-(\\d+)$`, 'i').exec(protocolo.trim());
  if (!m) return null;
  const seq = Number(m[1]);
  return Number.isFinite(seq) ? seq : null;
}

export function formatProtocol(year: number, seq: number): string {
  return `OS-${year}-${String(seq).padStart(3, '0')}`;
}

/** Próximo protocolo sequencial por prefeitura e ano civil. */
export async function nextProtocoloOs(
  collection: CollectionReference,
  prefeituraId: string,
  year = new Date().getFullYear(),
): Promise<string> {
  const snap = await collection
    .where('prefeituraId', '==', prefeituraId)
    .get();

  let maxSeq = 0;
  for (const doc of snap.docs) {
    const protocolo = String(doc.data().protocolo ?? '');
    const seq = parseProtocolSeq(protocolo, year);
    if (seq !== null && seq > maxSeq) maxSeq = seq;
  }

  return formatProtocol(year, maxSeq + 1);
}
