import type { Prisma } from '../../prisma/generated/client';
import type { GarantiaDoc } from '../../modules/garantias/garantias.types';
import { mapGarantiaFromFirestore } from '../../modules/garantias/helpers/garantias.mapper';
import { publicLegacyId } from './service-order-resolver';

type GarantiaRow = {
  id: string;
  legacyId: string | null;
  companyId: string;
  equipamentoId: string;
  equipamento: string;
  osOrigem: string;
  solicitacaoOsId: string | null;
  ordemServicoId: string | null;
  checklistDevolucaoId: string;
  tipo: string;
  item: string;
  partNumber: string | null;
  fornecedor: string;
  oficinaId: string;
  dataExecucao: Date;
  horimetroBase: unknown;
  prazoMeses: number;
  limiteHorimetro: unknown;
  venceEm: Date;
  status: string;
  createdAt: Date;
  company?: { legacyId: string | null };
};

function dateToIsoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

export function parseGarantiaDate(value: string): Date {
  const trimmed = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    const [yyyy, mm, dd] = trimmed.split('-').map(Number);
    return new Date(Date.UTC(yyyy, mm - 1, dd));
  }
  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

export function mapGarantiaFromRow(row: GarantiaRow): GarantiaDoc {
  const prefeituraId = row.company?.legacyId ?? row.companyId;
  return mapGarantiaFromFirestore(publicLegacyId(row), {
    prefeituraId,
    equipamentoId: row.equipamentoId,
    equipamento: row.equipamento,
    osOrigem: row.osOrigem,
    solicitacaoOsId: row.solicitacaoOsId,
    ordemServicoId: row.ordemServicoId,
    checklistDevolucaoId: row.checklistDevolucaoId,
    tipo: row.tipo,
    item: row.item,
    partNumber: row.partNumber,
    fornecedor: row.fornecedor,
    oficinaId: row.oficinaId,
    dataExecucao: dateToIsoDate(row.dataExecucao),
    horimetroBase: row.horimetroBase,
    prazoMeses: row.prazoMeses,
    limiteHorimetro: row.limiteHorimetro,
    venceEm: dateToIsoDate(row.venceEm),
    status: row.status,
    createdAt: row.createdAt.toISOString(),
  });
}

export function garantiaDocToPrismaCreate(
  doc: GarantiaDoc,
  companyId: string,
): Prisma.GarantiaUncheckedCreateInput {
  return {
    legacyId: doc.id,
    companyId,
    equipamentoId: doc.equipamentoId,
    equipamento: doc.equipamento,
    osOrigem: doc.osOrigem,
    solicitacaoOsId: doc.solicitacaoOsId,
    ordemServicoId: doc.ordemServicoId,
    checklistDevolucaoId: doc.checklistDevolucaoId,
    tipo: doc.tipo,
    item: doc.item,
    partNumber: doc.partNumber,
    fornecedor: doc.fornecedor,
    oficinaId: doc.oficinaId,
    dataExecucao: parseGarantiaDate(doc.dataExecucao),
    horimetroBase: doc.horimetroBase.toFixed(2),
    prazoMeses: doc.prazoMeses,
    limiteHorimetro: doc.limiteHorimetro.toFixed(2),
    venceEm: parseGarantiaDate(doc.venceEm),
    status: doc.status,
    createdAt: doc.createdAt ? new Date(doc.createdAt) : undefined,
  };
}
