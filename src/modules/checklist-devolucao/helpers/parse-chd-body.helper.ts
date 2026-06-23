import type { CreateChecklistDevolucaoDto } from '../dto/create-checklist-devolucao.dto';

function texto(valor: unknown): string {
  return typeof valor === 'string' ? valor.trim() : '';
}

function parseJsonValue<T>(raw: unknown): T | null {
  if (raw == null) return null;
  if (typeof raw === 'object') return raw as T;
  if (typeof raw !== 'string' || !raw.trim()) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

const JSON_FIELDS = [
  'identification',
  'identificacao',
  'generalState',
  'modules',
  'parts',
  'pecas',
  'services',
  'servicos',
  'closing',
] as const;

/** Normaliza body JSON ou multipart (campos stringificados / wrapper data). */
export function parseChdRequestBody(body: unknown): CreateChecklistDevolucaoDto {
  let raw: Record<string, unknown>;

  if (!body || typeof body !== 'object') {
    return {} as CreateChecklistDevolucaoDto;
  }

  const root = body as Record<string, unknown>;
  const wrapped =
    parseJsonValue<Record<string, unknown>>(root.data) ??
    parseJsonValue<Record<string, unknown>>(root.payload) ??
    parseJsonValue<Record<string, unknown>>(root.body);

  raw = wrapped ?? root;

  for (const key of JSON_FIELDS) {
    const parsed = parseJsonValue(raw[key]);
    if (parsed != null) raw[key] = parsed;
  }

  if (raw.identificacao && !raw.identification) {
    raw.identification = raw.identificacao;
  }
  if (raw.pecas && !raw.parts) {
    raw.parts = raw.pecas;
  }
  if (raw.servicos && !raw.services) {
    raw.services = raw.servicos;
  }

  if (Array.isArray(raw.parts) && !raw.pecas) {
    raw.parts = { items: raw.parts };
  }
  if (Array.isArray(raw.pecas) && !raw.parts) {
    raw.parts = { items: raw.pecas };
  }

  const parts = raw.parts ?? raw.pecas;
  if (parts && typeof parts === 'object' && !Array.isArray(parts)) {
    const block = parts as Record<string, unknown>;
    const items = parseJsonValue<unknown[]>(block.items);
    if (items) block.items = items;
    raw.parts = block;
  } else if (Array.isArray(parts)) {
    raw.parts = { items: parts };
  }

  if (texto(raw.protocolo) && raw.identification && typeof raw.identification === 'object') {
    const id = raw.identification as Record<string, unknown>;
    if (!texto(id.os)) id.os = raw.protocolo;
  }

  return raw as unknown as CreateChecklistDevolucaoDto;
}
