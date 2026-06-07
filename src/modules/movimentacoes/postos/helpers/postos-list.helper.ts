export function formatBRL(value: number): string {
  return value.toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  });
}

export function formatPrecoPorLitro(value: number | null): string {
  if (value === null) return '—';
  return formatBRL(value);
}

export function formatLitros(value: number): string {
  return `${Math.round(value).toLocaleString('pt-BR')} L`;
}

export interface AbastecimentoPostoStats {
  abastecimentos: number;
  totalLitros: number;
  totalGasto: number;
  precoMedioPorLitro: number | null;
}

export function extractAbastecimentoValues(data: Record<string, unknown>): {
  liters: number;
  gasto: number;
} {
  const liters = typeof data.liters === 'number' ? data.liters : 0;
  const pricePerLiter =
    typeof data.pricePerLiter === 'number'
      ? data.pricePerLiter
      : typeof data.precoPorLitro === 'number'
        ? data.precoPorLitro
        : typeof data.price === 'number'
          ? data.price
          : 0;
  const gasto =
    typeof data.total === 'number'
      ? data.total
      : typeof data.totalGasto === 'number'
        ? data.totalGasto
        : liters * pricePerLiter;

  return { liters, gasto };
}

export function isWithinPeriod(
  createdAt: unknown,
  startIso?: string,
  endIso?: string,
): boolean {
  if (typeof createdAt !== 'string') return false;
  if (startIso && createdAt < startIso) return false;
  if (endIso && createdAt > endIso) return false;
  return true;
}
