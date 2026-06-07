import { ReabastecimentoSourceType } from '../dto/create-reabastecimento.dto';

export function parseReceivedLiters(value: number): number | null {
  const liters = Number(value);
  if (!Number.isFinite(liters) || liters <= 0) {
    return null;
  }
  return liters;
}

export function isSupportedSourceType(
  value: string,
): value is ReabastecimentoSourceType {
  return (
    value === 'gasStation' || value === 'farmTank' || value === 'distributor'
  );
}

export function sanitizeForDocId(input: string): string {
  return input.trim().replace(/\//g, '_');
}
