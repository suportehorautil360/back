import {
  GREASED_POINT_OPTIONS,
  GreasedPoint,
  READING_UNIT_OPTIONS,
  ReadingUnit,
} from '../lubrificacoes.types';

export function parseReading(value: number): number | null {
  const reading = Number(value);
  if (!Number.isFinite(reading) || reading < 0) {
    return null;
  }
  return reading;
}

export function isSupportedReadingUnit(value: string): value is ReadingUnit {
  return READING_UNIT_OPTIONS.includes(value as ReadingUnit);
}

export function sanitizeGreasedPoints(values: GreasedPoint[]): GreasedPoint[] {
  return [...new Set(values)].filter((value): value is GreasedPoint =>
    GREASED_POINT_OPTIONS.includes(value),
  );
}
