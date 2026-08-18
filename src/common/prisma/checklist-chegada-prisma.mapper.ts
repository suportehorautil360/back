import type { Prisma } from '../../prisma/generated/client';
import type { ChecklistChegadaDoc } from '../../modules/checklist-chegada/checklist-chegada.types';
import { mapChecklistChegadaFromFirestore } from '../../modules/checklist-chegada/helpers/checklist-chegada.mapper';
import { publicLegacyId } from './service-order-resolver';

function toJson(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

type CheRow = {
  id: string;
  legacyId: string | null;
  companyId: string;
  number: string;
  oficinaId: string | null;
  osProtocolo: string | null;
  solicitacaoOsId: string | null;
  identification: unknown;
  photos: unknown;
  inspection: unknown;
  blocks: unknown;
  term: unknown;
  createdAt: Date;
  updatedAt: Date;
  company?: { legacyId: string | null };
};

export function mapChecklistChegadaFromRow(row: CheRow): ChecklistChegadaDoc {
  const prefeituraId = row.company?.legacyId ?? row.companyId;
  const payload: Record<string, unknown> = {
    number: row.number,
    oficinaId: row.oficinaId ?? '',
    prefeituraId,
    solicitacaoOsId: row.solicitacaoOsId,
    identification: row.identification,
    photos: row.photos,
    inspection: row.inspection,
    blocks: row.blocks,
    term: row.term,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
  return mapChecklistChegadaFromFirestore(publicLegacyId(row), payload);
}

export function checklistChegadaToPrismaCreate(
  doc: ChecklistChegadaDoc,
  companyId: string,
  legacyId: string,
): Prisma.ChecklistChegadaUncheckedCreateInput {
  return {
    legacyId,
    companyId,
    number: doc.number,
    oficinaId: doc.oficinaId,
    osProtocolo: doc.identification.os || null,
    solicitacaoOsId: doc.solicitacaoOsId,
    identification: toJson(doc.identification),
    photos: toJson(doc.photos),
    inspection: toJson(doc.inspection),
    blocks: toJson(doc.blocks),
    term: toJson(doc.term),
  };
}

export function checklistChegadaPatchToPrisma(
  patch: Partial<{
    photos: unknown;
    inspection: unknown;
    blocks: unknown;
  }>,
): Prisma.ChecklistChegadaUpdateInput {
  const data: Prisma.ChecklistChegadaUpdateInput = {};
  if (patch.photos !== undefined) data.photos = toJson(patch.photos);
  if (patch.inspection !== undefined) data.inspection = toJson(patch.inspection);
  if (patch.blocks !== undefined) data.blocks = toJson(patch.blocks);
  return data;
}
