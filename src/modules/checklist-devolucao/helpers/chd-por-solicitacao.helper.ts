import { mapChecklistDevolucaoFromFirestore } from './checklist-devolucao.mapper';
import { mapChecklistDevolucaoFromRow } from '../../../common/prisma/checklist-devolucao-prisma.mapper';
import type { PrismaService } from '../../../prisma/prisma.service';
import type { ChecklistDevolucaoDoc } from '../checklist-devolucao.types';

function texto(valor: unknown): string {
  return typeof valor === 'string' ? valor.trim() : '';
}

type ChdCollection = FirebaseFirestore.CollectionReference;

/** CHDs vinculados à solicitação (solicitacaoOsId ou identification.os). */
export async function buscarChdsPorSolicitacao(
  chdCollection: ChdCollection,
  solicitacaoOsId: string,
  protocolo?: string,
): Promise<ChecklistDevolucaoDoc[]> {
  const map = new Map<string, ChecklistDevolucaoDoc>();

  const bySol = await chdCollection
    .where('solicitacaoOsId', '==', solicitacaoOsId)
    .get();

  for (const doc of bySol.docs) {
    map.set(
      doc.id,
      mapChecklistDevolucaoFromFirestore(
        doc.id,
        doc.data() as Record<string, unknown>,
      ),
    );
  }

  const proto = texto(protocolo);
  if (proto) {
    const byProto = await chdCollection
      .where('identification.os', '==', proto)
      .get();
    for (const doc of byProto.docs) {
      if (map.has(doc.id)) continue;
      map.set(
        doc.id,
        mapChecklistDevolucaoFromFirestore(
          doc.id,
          doc.data() as Record<string, unknown>,
        ),
      );
    }
  }

  return [...map.values()]
    .filter((chd) => chd.status !== 'contestado')
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function chunks<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    out.push(arr.slice(i, i + size));
  }
  return out;
}

/** CHDs de todas as solicitações do equipamento. */
export async function buscarChdsPorEquipamento(
  chdCollection: ChdCollection,
  solicitacoesCollection: FirebaseFirestore.CollectionReference,
  equipamentoId: string,
): Promise<ChecklistDevolucaoDoc[]> {
  const solSnap = await solicitacoesCollection
    .where('equipamentoId', '==', equipamentoId)
    .get();

  const solIds = solSnap.docs.map((doc) => doc.id);
  if (!solIds.length) return [];

  const map = new Map<string, ChecklistDevolucaoDoc>();

  for (const batch of chunks(solIds, 10)) {
    const chdSnap = await chdCollection
      .where('solicitacaoOsId', 'in', batch)
      .get();

    for (const doc of chdSnap.docs) {
      map.set(
        doc.id,
        mapChecklistDevolucaoFromFirestore(
          doc.id,
          doc.data() as Record<string, unknown>,
        ),
      );
    }
  }

  return [...map.values()]
    .filter((chd) => chd.status !== 'contestado')
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function buscarChdsPorSolicitacaoPg(
  prisma: PrismaService,
  solicitacaoOsId: string,
  protocolo?: string,
): Promise<ChecklistDevolucaoDoc[]> {
  const map = new Map<string, ChecklistDevolucaoDoc>();

  const bySol = await prisma.checklistDevolucao.findMany({
    where: { solicitacaoOsId },
    include: { company: { select: { legacyId: true } } },
  });

  for (const row of bySol) {
    map.set(row.id, mapChecklistDevolucaoFromRow(row));
  }

  const proto = texto(protocolo);
  if (proto) {
    const byProto = await prisma.checklistDevolucao.findMany({
      where: { osProtocolo: proto },
      include: { company: { select: { legacyId: true } } },
    });
    for (const row of byProto) {
      if (map.has(row.id)) continue;
      map.set(row.id, mapChecklistDevolucaoFromRow(row));
    }
  }

  return [...map.values()]
    .filter((chd) => chd.status !== 'contestado')
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function buscarChdsPorEquipamentoPg(
  prisma: PrismaService,
  equipamentoId: string,
): Promise<ChecklistDevolucaoDoc[]> {
  const id = equipamentoId.trim();
  if (!id) return [];

  const sols = await prisma.serviceOrder.findMany({
    where: {
      OR: [
        { equipmentId: id },
        { equipment: { OR: [{ id }, { legacyId: id }] } },
      ],
    },
    select: { id: true, legacyId: true },
  });

  const solIds = [
    ...new Set(
      sols.flatMap((s) => [s.id, s.legacyId].filter((v): v is string => !!v)),
    ),
  ];
  if (!solIds.length) return [];

  const map = new Map<string, ChecklistDevolucaoDoc>();

  for (const batch of chunks(solIds, 50)) {
    const rows = await prisma.checklistDevolucao.findMany({
      where: { solicitacaoOsId: { in: batch } },
      include: { company: { select: { legacyId: true } } },
    });
    for (const row of rows) {
      map.set(row.id, mapChecklistDevolucaoFromRow(row));
    }
  }

  return [...map.values()]
    .filter((chd) => chd.status !== 'contestado')
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
