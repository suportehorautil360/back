import { BadRequestException } from '@nestjs/common';

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

export function formatDateTime(isoString: string): string {
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) {
    return isoString;
  }

  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const hour = String(date.getHours()).padStart(2, '0');
  const minute = String(date.getMinutes()).padStart(2, '0');
  return `${day}/${month}, ${hour}:${minute}`;
}

/**
 * Início do dia (UTC) para YYYY-MM-DD — evita o bug de `new Date('YYYY-MM-DD')`
 * + setHours(local), que desloca o intervalo conforme o fuso do servidor.
 */
export function parseDateStart(rawDate: string, fieldName: string): Date {
  const trimmed = rawDate?.trim() ?? '';
  const m = DATE_ONLY.exec(trimmed);
  if (m) {
    const y = Number(m[1]);
    const mo = Number(m[2]);
    const d = Number(m[3]);
    return new Date(Date.UTC(y, mo - 1, d, 0, 0, 0, 0));
  }

  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) {
    throw new BadRequestException(`O campo ${fieldName} é inválido.`);
  }
  parsed.setUTCHours(0, 0, 0, 0);
  return parsed;
}

/** Fim do dia (UTC) para YYYY-MM-DD — intervalo inclusivo no calendário. */
export function parseDateEnd(rawDate: string, fieldName: string): Date {
  const trimmed = rawDate?.trim() ?? '';
  const m = DATE_ONLY.exec(trimmed);
  if (m) {
    const y = Number(m[1]);
    const mo = Number(m[2]);
    const d = Number(m[3]);
    return new Date(Date.UTC(y, mo - 1, d, 23, 59, 59, 999));
  }

  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) {
    throw new BadRequestException(`O campo ${fieldName} é inválido.`);
  }
  parsed.setUTCHours(23, 59, 59, 999);
  return parsed;
}
