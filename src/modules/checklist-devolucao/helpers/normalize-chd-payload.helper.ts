import type {
  ChecklistDevolucaoPartItem,
  ChecklistDevolucaoServiceItem,
} from '../checklist-devolucao.types';
import type { CreateChecklistDevolucaoDto } from '../dto/create-checklist-devolucao.dto';
import { mapOldPartDestinationValue } from './old-part-destination.helper';

function texto(valor: unknown): string {
  return typeof valor === 'string' ? valor.trim() : '';
}

function parseJsonArray(raw: unknown): unknown[] | null {
  if (Array.isArray(raw)) return raw;
  if (typeof raw !== 'string' || !raw.trim()) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function extractItems(
  loose: Record<string, unknown>,
  dtoBlock: unknown,
  keys: string[],
): unknown[] {
  for (const key of keys) {
    const fromRoot = loose[key];
    const parsedRoot = parseJsonArray(fromRoot);
    if (parsedRoot) return parsedRoot;

    if (fromRoot && typeof fromRoot === 'object' && !Array.isArray(fromRoot)) {
      const block = fromRoot as Record<string, unknown>;
      const parsedItems = parseJsonArray(block.items);
      if (parsedItems) return parsedItems;
      if (Array.isArray(block.items)) return block.items;
    }

    if (Array.isArray(fromRoot)) return fromRoot;
  }

  if (dtoBlock && typeof dtoBlock === 'object') {
    const block = dtoBlock as Record<string, unknown>;
    if (Array.isArray(block.items)) return block.items;
    const parsed = parseJsonArray(block.items);
    if (parsed) return parsed;
  }

  return [];
}

export function normalizePartItem(raw: unknown): ChecklistDevolucaoPartItem | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;

  const description =
    texto(r.description) ||
    texto(r.descricao) ||
    texto(r.descricaoPeca) ||
    texto(r.item);

  const partNumber =
    texto(r.partNumber) ||
    texto(r.part_number) ||
    texto(r.numeroPeca) ||
    texto(r.codigoPeca) ||
    texto(r.codPeca);

  const brand = texto(r.brand) || texto(r.marca);

  const oldPartDestination = mapOldPartDestinationValue(
    r.oldPartDestination ??
      r.destinacaoPecaVelha ??
      r.destinoPecaVelha ??
      r.destinacao,
  );

  const newPhoto =
    texto(r.newPhoto) ||
    texto(r.fotoNova) ||
    texto(r.fotoPecaNova) ||
    texto(r.newPhotoUrl);

  const replacedPhoto =
    texto(r.replacedPhoto) ||
    texto(r.fotoSubstituida) ||
    texto(r.fotoPecaVelha) ||
    texto(r.fotoVelha) ||
    texto(r.replacedPhotoUrl);

  if (!description && !partNumber && !brand) return null;

  const mapped: ChecklistDevolucaoPartItem = {
    description: description || partNumber || brand,
    partNumber,
    brand,
    oldPartDestination,
  };
  if (newPhoto) mapped.newPhoto = newPhoto;
  if (replacedPhoto) mapped.replacedPhoto = replacedPhoto;
  return mapped;
}

export function normalizeServiceItem(
  raw: unknown,
): ChecklistDevolucaoServiceItem | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;

  const systemComponent =
    texto(r.systemComponent) ||
    texto(r.sistema) ||
    texto(r.sistemaComponente) ||
    texto(r.componente);

  const initialDiagnosis =
    texto(r.initialDiagnosis) ||
    texto(r.diagnosticoInicial) ||
    texto(r.diagnostico);

  const technicalAction =
    texto(r.technicalAction) ||
    texto(r.acaoTecnica) ||
    texto(r.acaoExecutada);

  const technician = texto(r.technician) || texto(r.tecnico);
  const manHours =
    texto(r.manHours) ||
    texto(r.tempoHH) ||
    texto(r.horas) ||
    texto(r.hh);

  if (!systemComponent && !technicalAction) return null;

  return {
    systemComponent: systemComponent || technicalAction,
    initialDiagnosis,
    technicalAction,
    technician,
    manHours: manHours || '2.5',
  };
}

export function extractPartsFromPayload(
  dto: CreateChecklistDevolucaoDto,
): ChecklistDevolucaoPartItem[] {
  const loose = dto as unknown as Record<string, unknown>;
  const rawItems = extractItems(loose, dto.parts, ['parts', 'pecas', 'peca']);

  return rawItems
    .map(normalizePartItem)
    .filter((item): item is ChecklistDevolucaoPartItem => item !== null);
}

export function extractServicesFromPayload(
  dto: CreateChecklistDevolucaoDto,
): ChecklistDevolucaoServiceItem[] {
  const loose = dto as unknown as Record<string, unknown>;
  const rawItems = extractItems(loose, dto.services, [
    'services',
    'servicos',
    'servico',
  ]);

  return rawItems
    .map(normalizeServiceItem)
    .filter((item): item is ChecklistDevolucaoServiceItem => item !== null);
}

/** Conta peças no body bruto (antes da normalização) — útil para detectar perda no POST. */
export function countPartsHintInRawBody(body: unknown): number {
  if (!body || typeof body !== 'object') return 0;
  const raw = body as Record<string, unknown>;
  const wrapped =
    (typeof raw.data === 'string' && raw.data.trim()
      ? (() => {
          try {
            return JSON.parse(raw.data) as Record<string, unknown>;
          } catch {
            return null;
          }
        })()
      : null) ??
    (raw.data && typeof raw.data === 'object'
      ? (raw.data as Record<string, unknown>)
      : null);

  const sources = [raw, wrapped].filter(Boolean) as Record<string, unknown>[];
  for (const source of sources) {
    const count = extractPartsFromPatchBody(source.parts ?? source.pecas).length;
    if (count > 0) return count;
  }
  return 0;
}

export function extractPartsFromPatchBody(parts: unknown): ChecklistDevolucaoPartItem[] {
  if (Array.isArray(parts)) {
    return parts
      .map(normalizePartItem)
      .filter((item): item is ChecklistDevolucaoPartItem => item !== null);
  }

  if (parts && typeof parts === 'object') {
    const block = parts as { items?: unknown };
    const list = Array.isArray(block.items)
      ? block.items
      : parseJsonArray(block.items);
    if (list) {
      return list
        .map(normalizePartItem)
        .filter((item): item is ChecklistDevolucaoPartItem => item !== null);
    }
  }

  return [];
}

export function normalizeCreateChecklistDevolucaoDto(
  dto: CreateChecklistDevolucaoDto,
): CreateChecklistDevolucaoDto {
  return {
    ...dto,
    parts: { items: extractPartsFromPayload(dto) },
    services: { items: extractServicesFromPayload(dto) },
  };
}
