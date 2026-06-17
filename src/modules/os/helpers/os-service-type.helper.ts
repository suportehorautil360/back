import type { OsServiceType } from '../os.types';
import { OS_SERVICE_TYPES } from '../os.types';

const LEGACY_LETTER: Record<OsServiceType, 'C' | 'P'> = {
  corrective: 'C',
  preventive: 'P',
};

const LABEL_PT: Record<OsServiceType, string> = {
  corrective: 'Corretiva',
  preventive: 'Preventiva',
};

/** Valores aceitos na API (inglês) e legado (C/P). */
export function normalizeOsServiceType(raw?: string): OsServiceType {
  const v = raw?.trim().toLowerCase();
  if (!v) return 'corrective';

  if (v === 'p' || v === 'preventive' || v === 'preventiva') {
    return 'preventive';
  }
  if (v === 'c' || v === 'corrective' || v === 'corretiva') {
    return 'corrective';
  }
  if (isOsServiceType(v)) {
    return v;
  }

  return 'corrective';
}

export function isOsServiceType(value: string): value is OsServiceType {
  return (OS_SERVICE_TYPES as readonly string[]).includes(value);
}

/** Código legado gravado em `tipoOs` (formulário C/P). */
export function tipoOsLegacyCode(serviceType: OsServiceType): 'C' | 'P' {
  return LEGACY_LETTER[serviceType];
}

export function osServiceTypeLabel(serviceType: OsServiceType): string {
  return LABEL_PT[serviceType];
}

/** Lê `serviceType` ou deriva de `tipoOs` legado em documentos antigos. */
export function osServiceTypeFromFirestore(data: {
  serviceType?: unknown;
  tipoOs?: unknown;
}): OsServiceType {
  const explicit = texto(data.serviceType);
  if (explicit && isOsServiceType(explicit)) return explicit;

  const legado = texto(data.tipoOs).toUpperCase();
  if (legado === 'P') return 'preventive';
  return 'corrective';
}

function texto(valor: unknown): string {
  return typeof valor === 'string' ? valor.trim() : '';
}
