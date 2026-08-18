import type { Prisma } from '../../prisma/generated/client';
import type { ChecklistDevolucaoDoc } from '../../modules/checklist-devolucao/checklist-devolucao.types';
import { mapChecklistDevolucaoFromFirestore } from '../../modules/checklist-devolucao/helpers/checklist-devolucao.mapper';
import { publicLegacyId } from './service-order-resolver';

function toJson(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

type ChdRow = {
  id: string;
  legacyId: string | null;
  companyId: string;
  number: string;
  oficinaId: string | null;
  oficinaNome: string | null;
  osProtocolo: string | null;
  solicitacaoOsId: string | null;
  ordemServicoId: string | null;
  identification: unknown;
  generalState: unknown;
  modules: unknown;
  parts: unknown;
  services: unknown;
  closing: unknown;
  status: string;
  prefeituraConferencia: unknown;
  createdAt: Date;
  updatedAt: Date;
  company?: { legacyId: string | null };
};

export function mapChecklistDevolucaoFromRow(row: ChdRow): ChecklistDevolucaoDoc {
  const prefeituraId = row.company?.legacyId ?? row.companyId;
  const payload: Record<string, unknown> = {
    number: row.number,
    oficinaId: row.oficinaId ?? '',
    prefeituraId,
    solicitacaoOsId: row.solicitacaoOsId,
    ordemServicoId: row.ordemServicoId,
    identification: row.identification,
    generalState: row.generalState,
    modules: row.modules,
    parts: row.parts,
    services: row.services,
    closing: row.closing,
    status: row.status,
    prefeituraConferencia: row.prefeituraConferencia,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
  return mapChecklistDevolucaoFromFirestore(publicLegacyId(row), payload);
}

export function checklistDevolucaoToPrismaCreate(
  doc: ChecklistDevolucaoDoc,
  companyId: string,
  legacyId: string,
): Prisma.ChecklistDevolucaoUncheckedCreateInput {
  return {
    legacyId,
    companyId,
    number: doc.number,
    oficinaId: doc.oficinaId,
    osProtocolo: doc.identification.os || null,
    solicitacaoOsId: doc.solicitacaoOsId,
    ordemServicoId: null,
    identification: toJson(doc.identification),
    generalState: toJson(doc.generalState),
    modules: toJson(doc.modules),
    parts: toJson(doc.parts),
    services: toJson(doc.services),
    closing: toJson(doc.closing),
    status: doc.status,
    prefeituraConferencia: doc.prefeituraConferencia
      ? toJson(doc.prefeituraConferencia)
      : undefined,
  };
}

export function checklistDevolucaoPatchToPrisma(
  patch: Partial<{
    generalState: unknown;
    parts: unknown;
    status: string;
    prefeituraConferencia: unknown;
  }>,
): Prisma.ChecklistDevolucaoUpdateInput {
  const data: Prisma.ChecklistDevolucaoUpdateInput = {};
  if (patch.generalState !== undefined) {
    data.generalState = toJson(patch.generalState);
  }
  if (patch.parts !== undefined) {
    data.parts = toJson(patch.parts);
  }
  if (patch.status !== undefined) data.status = patch.status;
  if (patch.prefeituraConferencia !== undefined) {
    data.prefeituraConferencia = toJson(patch.prefeituraConferencia);
  }
  return data;
}
