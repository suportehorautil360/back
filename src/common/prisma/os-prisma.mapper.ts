import type { Prisma } from '../../prisma/generated/client';
import {
  parseHorimetroMedicaoFields,
} from '../../modules/os/helpers/enrich-solicitacoes-equipamento.helper';
import { mapOrdemServicoListItem } from '../../modules/os/helpers/ordem-servico-list.helper';
import {
  osServiceTypeFromFirestore,
  osServiceTypeLabel,
} from '../../modules/os/helpers/os-service-type.helper';
import {
  parseLances,
  parseOficinasResponderam,
  resolveOficinaVencedoraId,
  resolveValorAprovado,
  valorOrcadoForOficina,
} from '../../modules/os/helpers/lances-os.helper';
import { solicitacaoStatusLabel } from '../../modules/os/helpers/status-label.helper';
import type {
  OrdemOrcamentoListItem,
  SolicitacaoOsListItem,
} from '../../modules/os/os.types';
import { publicLegacyId } from './service-order-resolver';

type ServiceOrderRow = {
  id: string;
  legacyId: string | null;
  companyId: string;
  protocolo: string;
  tipoOs: string;
  serviceType: string | null;
  equipmentId: string | null;
  equipmentNome: string | null;
  linha: string | null;
  segmento: string | null;
  horimetro: string | null;
  operadorNome: string | null;
  relato: string;
  status: string;
  oficinasIds: unknown;
  oficinasNomes: unknown;
  oficinasResponderam: unknown;
  lances: unknown;
  aprovadoEm: Date | null;
  valorAprovado: unknown;
  oficinaVencedoraId: string | null;
  ordemServicoAprovadaId: string | null;
  createdAt: Date;
  company: { legacyId: string | null };
  equipment?: { id: string; legacyId: string | null } | null;
};

type OrcamentoRow = {
  id: string;
  legacyId: string | null;
  protocolo: string;
  oficinaId: string | null;
  oficinaNome: string | null;
  operadorNome: string | null;
  equipamento: string | null;
  defeito: string | null;
  itens: unknown;
  valorTotal: unknown;
  prazoDias: number | null;
  status: string;
  fotosComprovacao: unknown;
  createdAt: Date;
  serviceOrder: { id: string; legacyId: string | null };
};

function texto(valor: unknown): string {
  return typeof valor === 'string' ? valor.trim() : '';
}

function listaTexto(valor: unknown): string[] {
  if (!Array.isArray(valor)) return [];
  return valor.filter((v): v is string => typeof v === 'string' && v.trim() !== '');
}

function numero(valor: unknown): number {
  if (typeof valor === 'number') return Number.isFinite(valor) ? valor : 0;
  if (typeof valor === 'string') {
    const n = Number(valor.replace(',', '.'));
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

function dateToIso(value: Date | null | undefined): string {
  if (!value) return '';
  return value.toISOString();
}

function dateToSeconds(value: Date | null | undefined): { seconds: number } | null {
  if (!value) return null;
  return { seconds: Math.floor(value.getTime() / 1000) };
}

function formatDateBrFromIso(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('pt-BR');
}

function parseFotosComprovacao(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((url): url is string => typeof url === 'string' && url.trim().length > 0);
}

export function mapServiceOrderToListItem(
  row: ServiceOrderRow,
  oficinaIdContext?: string,
): SolicitacaoOsListItem {
  const id = publicLegacyId(row);
  const prefeituraId = row.company.legacyId ?? row.companyId;
  const createdAt = dateToIso(row.createdAt);
  const status = texto(row.status) || 'aguardando_orcamento';
  const serviceType = osServiceTypeFromFirestore({
    serviceType: row.serviceType,
    tipoOs: row.tipoOs,
  });
  const lances = parseLances(row.lances);
  const oficinasIds = listaTexto(row.oficinasIds);
  const oficinasNomes = listaTexto(row.oficinasNomes);
  const oficinasResponderam = parseOficinasResponderam(row.oficinasResponderam);
  const valorOrcado = oficinaIdContext
    ? valorOrcadoForOficina(lances, oficinaIdContext)
    : null;
  const equipmentId =
    row.equipment?.legacyId ??
    row.equipment?.id ??
    '';
  const horimetro = texto(row.horimetro);
  const medicaoSnapshot = parseHorimetroMedicaoFields(horimetro);
  const rawRecord = row as unknown as Record<string, unknown>;
  const oficinaVencedoraId = resolveOficinaVencedoraId(rawRecord, lances);
  const valorAprovado = resolveValorAprovado(
    rawRecord,
    lances,
    oficinaVencedoraId,
  );

  return {
    id,
    protocol: row.protocolo,
    equipment: texto(row.equipmentNome),
    equipmentId,
    chassis: '',
    horimetro,
    hourMeter: medicaoSnapshot.hourMeter,
    currentKm: medicaoSnapshot.currentKm,
    km: medicaoSnapshot.km,
    medicaoAtual: null,
    unidadeRevisao: medicaoSnapshot.unidadeRevisao,
    line: texto(row.linha),
    operator: texto(row.operadorNome),
    report: texto(row.relato),
    workshops: oficinasNomes,
    workshopIds: oficinasIds,
    status,
    statusLabel: solicitacaoStatusLabel(status),
    serviceType,
    serviceTypeLabel: osServiceTypeLabel(serviceType),
    dateLabel: formatDateBrFromIso(createdAt),
    createdAt,
    protocolo: row.protocolo,
    equipamento: texto(row.equipmentNome),
    equipamentoId: equipmentId,
    chassi: '',
    linha: texto(row.linha),
    operador: texto(row.operadorNome),
    relato: texto(row.relato),
    oficinas: oficinasNomes,
    oficinasIds,
    oficinasResponderam,
    lances,
    valorOrcado,
    ordemServicoAprovadaId: texto(row.ordemServicoAprovadaId) || undefined,
    oficinaVencedoraId: oficinaVencedoraId || undefined,
    valorAprovado,
    aprovadoEm: dateToIso(row.aprovadoEm) || null,
    criadoEm: dateToSeconds(row.createdAt),
    prefeituraId,
  } as SolicitacaoOsListItem & { prefeituraId: string };
}

export function mapOrcamentoToListItem(
  row: OrcamentoRow,
): OrdemOrcamentoListItem {
  const solicitacaoOsId = publicLegacyId(row.serviceOrder);
  const data = {
    protocolo: row.protocolo,
    protocol: row.protocolo,
    solicitacaoOsId,
    oficinaId: texto(row.oficinaId),
    oficinaNome: texto(row.oficinaNome),
    operador: texto(row.operadorNome),
    equipamento: texto(row.equipamento),
    defeito: texto(row.defeito),
    itens: row.itens,
    valorTotal: Number(row.valorTotal),
    prazoDias: row.prazoDias,
    status: row.status,
    fotosComprovacao: parseFotosComprovacao(row.fotosComprovacao),
    criadoEm: row.createdAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
  };

  return mapOrdemServicoListItem(publicLegacyId(row), data);
}

export function serviceOrderToFirestoreShape(
  row: ServiceOrderRow,
): Record<string, unknown> {
  return {
    prefeituraId: row.company.legacyId ?? row.companyId,
    oficinasIds: row.oficinasIds,
    oficinasResponderam: row.oficinasResponderam,
    status: row.status,
  };
}

export function decimalToNumber(value: Prisma.Decimal | number | null | undefined): number {
  if (value === null || value === undefined) return 0;
  return Number(value);
}

export function toInputJson<T>(value: T): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}
