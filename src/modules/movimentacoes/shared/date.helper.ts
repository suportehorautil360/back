import { BadRequestException } from '@nestjs/common';

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

export function parseDateStart(rawDate: string, fieldName: string): Date {
  const parsed = new Date(rawDate);
  if (Number.isNaN(parsed.getTime())) {
    throw new BadRequestException(`O campo ${fieldName} é inválido.`);
  }

  parsed.setHours(0, 0, 0, 0);
  return parsed;
}

export function parseDateEnd(rawDate: string, fieldName: string): Date {
  const parsed = new Date(rawDate);
  if (Number.isNaN(parsed.getTime())) {
    throw new BadRequestException(`O campo ${fieldName} é inválido.`);
  }

  parsed.setHours(23, 59, 59, 999);
  return parsed;
}
