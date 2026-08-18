import type {
  FrenteStatus,
  WorkFront,
  WorkFrontAllocation,
} from '../../prisma/generated/client';
import { publicLegacyId } from './service-order-resolver';

export function frenteStatusToApi(status: FrenteStatus): string {
  switch (status) {
    case 'PAUSADA':
      return 'paused';
    case 'CONCLUIDA':
      return 'concluida';
    default:
      return 'active';
  }
}

export function apiStatusToFrenteStatus(status: string): FrenteStatus {
  const s = status.toLowerCase();
  if (s.includes('pausa')) return 'PAUSADA';
  if (s.includes('conclu') || s.includes('finaliz')) return 'CONCLUIDA';
  return 'ATIVA';
}

export function mapWorkFrontToApi(
  row: WorkFront,
  prefeituraId: string,
): Record<string, unknown> {
  return {
    id: publicLegacyId(row),
    name: row.nome,
    prefeituraId,
    address: row.endereco ?? '',
    responsible: row.responsavelNome ?? '',
    ...(row.responsavelLegacyId
      ? { responsibleId: row.responsavelLegacyId }
      : {}),
    ...(row.telefone ? { telefone: row.telefone } : {}),
    ...(row.email ? { email: row.email } : {}),
    status: frenteStatusToApi(row.status),
    cost: Number(row.custo),
    startDate: row.inicio?.toISOString() ?? null,
    ...(row.fim ? { endDate: row.fim.toISOString() } : {}),
    createdAt: row.createdAt.toISOString(),
  };
}

export function formatAllocationStartDate(date: Date): string {
  const dd = String(date.getUTCDate()).padStart(2, '0');
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  const yyyy = date.getUTCFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

export function parseAllocationStartDate(value: string): Date {
  const trimmed = value.trim();
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(trimmed)) {
    const [dd, mm, yyyy] = trimmed.split('/').map(Number);
    return new Date(Date.UTC(yyyy, mm - 1, dd));
  }
  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

type AllocationRow = WorkFrontAllocation & {
  workFront?: Pick<WorkFront, 'id' | 'legacyId' | 'nome'> | null;
  equipment?: { id: string; legacyId: string | null; placa: string | null } | null;
};

export function mapAllocationToApi(
  row: AllocationRow,
  prefeituraId: string,
  workFrontName?: string,
): Record<string, unknown> {
  const wf = row.workFront;
  const wfPublicId = wf ? publicLegacyId(wf) : '';
  const equipPublicId = row.equipment
    ? publicLegacyId(row.equipment)
    : '';
  const nomeFrente = workFrontName ?? wf?.nome ?? '';

  return {
    id: publicLegacyId(row),
    vehicleId: equipPublicId,
    workFrontId: wfPublicId,
    plate: row.equipment?.placa ?? '',
    workFrontName: nomeFrente,
    startDate: formatAllocationStartDate(row.startDate),
    function: row.funcao ?? '',
    prefeituraId,
    status: row.endDate ? 'inactive' : 'active',
    createdAt: row.createdAt.toISOString(),
    currentWorkFront: { id: wfPublicId, name: nomeFrente },
  };
}
