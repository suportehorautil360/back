import { mapOldPartDestinationValue } from './old-part-destination.helper';
import {
  extractPartsFromPayload,
  extractServicesFromPayload,
  normalizePartItem,
  normalizeServiceItem,
} from './normalize-chd-payload.helper';
import type {
  ChecklistDevolucaoDoc,
  ChecklistDevolucaoModuleItem,
  ChecklistDevolucaoPartItem,
  ChecklistDevolucaoServiceItem,
  ChecklistDevolucaoStateItem,
} from '../checklist-devolucao.types';
import type { CreateChecklistDevolucaoDto } from '../dto/create-checklist-devolucao.dto';

function texto(valor: unknown): string {
  return typeof valor === 'string' ? valor.trim() : '';
}

function normalizeStatus(raw: unknown): ChecklistDevolucaoStateItem['status'] {
  const s = texto(raw).toLowerCase();
  if (s === 'ok') return 'ok';
  if (s === 'anomaly' || s === 'anomalia') return 'anomaly';
  if (s === 'na' || s === 'n/a') return 'na';
  return '';
}

export function mapGeneralStateItems(
  raw:
    | Record<string, { status?: string; photo?: string; description?: string }>
    | undefined,
): Record<string, ChecklistDevolucaoStateItem> {
  if (!raw || typeof raw !== 'object') return {};

  const out: Record<string, ChecklistDevolucaoStateItem> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!value || typeof value !== 'object') continue;
    const item: ChecklistDevolucaoStateItem = {
      status: normalizeStatus(value.status),
    };
    const photo = texto(value.photo);
    if (photo) item.photo = photo;
    const description = texto(value.description);
    if (description) item.description = description;
    out[key] = item;
  }
  return out;
}

export function mapModuleItems(
  raw:
    | Record<string, { status?: string; photo?: string; description?: string }>
    | undefined,
): Record<string, ChecklistDevolucaoModuleItem> {
  if (!raw || typeof raw !== 'object') return {};

  const out: Record<string, ChecklistDevolucaoModuleItem> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!value || typeof value !== 'object') continue;
    const item: ChecklistDevolucaoModuleItem = {
      status: normalizeStatus(value.status),
    };
    const photo = texto(value.photo);
    if (photo) item.photo = photo;
    const description = texto(value.description);
    if (description) item.description = description;
    out[key] = item;
  }
  return out;
}

function mapOldPartDestination(raw: unknown) {
  return mapOldPartDestinationValue(raw);
}

export { mapOldPartDestinationValue } from './old-part-destination.helper';

export function mapPartItems(
  items: CreateChecklistDevolucaoDto['parts']['items'] | unknown[] | undefined,
): ChecklistDevolucaoPartItem[] {
  if (!Array.isArray(items)) return [];

  return items
    .map((item) => normalizePartItem(item))
    .filter((item): item is ChecklistDevolucaoPartItem => item !== null);
}

export function mapServiceItems(
  items: CreateChecklistDevolucaoDto['services']['items'] | undefined,
): ChecklistDevolucaoServiceItem[] {
  if (!Array.isArray(items)) return [];

  return items.map((item) => ({
    systemComponent: texto(item.systemComponent),
    initialDiagnosis: texto(item.initialDiagnosis),
    technicalAction: texto(item.technicalAction),
    technician: texto(item.technician),
    manHours: texto(item.manHours),
  }));
}

export function buildChecklistDevolucaoDoc(
  id: string,
  number: string,
  dto: CreateChecklistDevolucaoDto,
  createdAt: string,
): ChecklistDevolucaoDoc {
  return {
    id,
    number,
    oficinaId: dto.oficinaId.trim(),
    parceiroId: texto(dto.parceiroId) || null,
    prefeituraId: texto(dto.prefeituraId) || null,
    solicitacaoOsId: texto(dto.solicitacaoOsId) || null,
    ordemServicoId: texto(dto.ordemServicoId) || null,
    identification: {
      os: texto(dto.identification.os),
      date: texto(dto.identification.date),
      time: texto(dto.identification.time),
      brandModel: texto(dto.identification.brandModel),
      platePrefix: texto(dto.identification.platePrefix),
      currentKm: texto(dto.identification.currentKm),
      hourMeter: texto(dto.identification.hourMeter),
      driver: texto(dto.identification.driver),
      technicalResponsible: texto(dto.identification.technicalResponsible),
      fuel: texto(dto.identification.fuel),
    },
    generalState: mapGeneralStateItems(dto.generalState),
    modules: mapModuleItems(dto.modules),
    parts: { items: extractPartsFromPayload(dto) },
    services: { items: extractServicesFromPayload(dto) },
    closing: {
      inventoryChecked: Boolean(dto.closing.inventoryChecked),
      driverSignature: texto(dto.closing.driverSignature),
      workshopSignature: texto(dto.closing.workshopSignature),
    },
    status: 'enviado',
    createdAt,
  };
}

export function mapChecklistDevolucaoFromFirestore(
  docId: string,
  data: Record<string, unknown>,
): ChecklistDevolucaoDoc {
  const identification = (data.identification ?? {}) as Record<string, unknown>;
  const partsRaw =
    data.parts ?? data.pecas ?? ({ items: [] } as Record<string, unknown>);
  const servicesRaw =
    data.services ?? data.servicos ?? ({ items: [] } as Record<string, unknown>);
  const closing = (data.closing ?? {}) as Record<string, unknown>;

  const partsItems = (() => {
    const block =
      partsRaw && typeof partsRaw === 'object'
        ? (partsRaw as { items?: unknown })
        : { items: [] };
    const list = Array.isArray(block.items)
      ? block.items
      : Array.isArray(partsRaw)
        ? partsRaw
        : [];
    return list
      .map((item) => normalizePartItem(item))
      .filter((item): item is ChecklistDevolucaoPartItem => item !== null);
  })();

  const serviceItems = (() => {
    const block =
      servicesRaw && typeof servicesRaw === 'object'
        ? (servicesRaw as { items?: unknown })
        : { items: [] };
    const list = Array.isArray(block.items)
      ? block.items
      : Array.isArray(servicesRaw)
        ? servicesRaw
        : [];
    return list
      .map((item) => normalizeServiceItem(item))
      .filter((item): item is ChecklistDevolucaoServiceItem => item !== null);
  })();

  const statusRaw = texto(data.status);
  const status =
    statusRaw === 'em_conferencia' ||
    statusRaw === 'aceito' ||
    statusRaw === 'contestado'
      ? statusRaw
      : 'enviado';

  const confRaw = data.prefeituraConferencia as Record<string, unknown> | undefined;
  const prefeituraConferencia =
    confRaw && typeof confRaw === 'object' && texto(confRaw.conferidoEm)
      ? {
          aceito: Boolean(confRaw.aceito),
          observacoes: texto(confRaw.observacoes) || null,
          conferidoPor: texto(confRaw.conferidoPor) || null,
          conferidoEm: texto(confRaw.conferidoEm),
        }
      : undefined;

  return {
    id: docId,
    number: texto(data.number),
    oficinaId: texto(data.oficinaId),
    parceiroId: texto(data.parceiroId) || null,
    prefeituraId: texto(data.prefeituraId) || null,
    solicitacaoOsId: texto(data.solicitacaoOsId) || null,
    ordemServicoId: texto(data.ordemServicoId) || null,
    identification: {
      os: texto(identification.os),
      date: texto(identification.date),
      time: texto(identification.time),
      brandModel: texto(identification.brandModel),
      platePrefix: texto(identification.platePrefix),
      currentKm: texto(identification.currentKm),
      hourMeter: texto(identification.hourMeter),
      driver: texto(identification.driver),
      technicalResponsible: texto(identification.technicalResponsible),
      fuel: texto(identification.fuel),
    },
    generalState: mapGeneralStateItems(
      data.generalState as Record<
        string,
        { status?: string; photo?: string; description?: string }
      >,
    ),
    modules: mapModuleItems(
      data.modules as Record<
        string,
        { status?: string; photo?: string; description?: string }
      >,
    ),
    parts: { items: partsItems },
    services: { items: serviceItems },
    closing: {
      inventoryChecked: Boolean(closing.inventoryChecked),
      driverSignature: texto(closing.driverSignature),
      workshopSignature: texto(closing.workshopSignature),
    },
    status,
    prefeituraConferencia,
    createdAt: texto(data.createdAt),
    updatedAt: texto(data.updatedAt) || undefined,
  };
}
