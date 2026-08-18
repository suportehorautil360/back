import type { CollectionReference } from 'firebase-admin/firestore';
import type { PrismaService } from '../../../prisma/prisma.service';

export function parseNumeroChegadaSeq(
  number: string,
  year: number,
): number | null {
  const m = new RegExp(`^CHE-${year}-(\\d+)$`, 'i').exec(number.trim());
  if (!m) return null;
  const seq = Number(m[1]);
  return Number.isFinite(seq) ? seq : null;
}

export function formatNumeroChegada(year: number, seq: number): string {
  return `CHE-${year}-${String(seq).padStart(4, '0')}`;
}

/** Próximo número CHE-{ano}-{seq} por oficina. */
export async function nextNumeroChegada(
  collection: CollectionReference,
  oficinaId: string,
  year = new Date().getFullYear(),
): Promise<string> {
  const snap = await collection.where('oficinaId', '==', oficinaId).get();

  let maxSeq = 0;
  for (const doc of snap.docs) {
    const numero = String(doc.data().number ?? '');
    const seq = parseNumeroChegadaSeq(numero, year);
    if (seq !== null && seq > maxSeq) maxSeq = seq;
  }

  return formatNumeroChegada(year, maxSeq + 1);
}

export async function nextNumeroChegadaPg(
  prisma: PrismaService,
  oficinaId: string,
  year = new Date().getFullYear(),
): Promise<string> {
  const rows = await prisma.checklistChegada.findMany({
    where: { oficinaId },
    select: { number: true },
  });

  let maxSeq = 0;
  for (const row of rows) {
    const seq = parseNumeroChegadaSeq(row.number, year);
    if (seq !== null && seq > maxSeq) maxSeq = seq;
  }

  return formatNumeroChegada(year, maxSeq + 1);
}
