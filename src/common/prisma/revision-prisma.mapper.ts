import { publicLegacyId } from './service-order-resolver';

type RevisionRow = {
  id: string;
  equipmentId: string;
  data: Date;
  leitura: number;
  unidade: string;
  oficina: string | null;
  custo: unknown;
  notaFiscal: string | null;
  servicos: string | null;
  status: string;
  createdAt: Date;
  equipment: {
    id: string;
    legacyId: string | null;
    tipo: string | null;
    company: { id: string; legacyId: string | null };
  };
};

export function mapRevisionToApi(row: RevisionRow) {
  const prefeituraId =
    row.equipment.company.legacyId ?? row.equipment.company.id;
  const vehicleId = publicLegacyId(row.equipment);

  return {
    id: row.id,
    revisionDate: row.data.toISOString(),
    odometerReading: row.leitura,
    mechanicOrOfficeName: row.oficina ?? '',
    servicesDescription: row.servicos ?? '',
    revisionCost: Number(row.custo ?? 0),
    invoiceNumber: row.notaFiscal ?? '',
    prefeituraId,
    vehicleId,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
  };
}

export function normalizeUnidadeRevisao(
  unidade: string | null | undefined,
): 'km' | 'horas' {
  const u = (unidade ?? '').toLowerCase();
  if (u === 'h' || u.includes('hora')) return 'horas';
  return 'km';
}
