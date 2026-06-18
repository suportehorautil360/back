import { TipoMedicao } from '../dto/create-abastecimento.dto';

export function normalizeIdentifier(value: unknown): string {
  const safeValue =
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
      ? String(value)
      : '';

  return safeValue
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

export function matchesPlateOrChassis(
  rawEquipment: Record<string, unknown>,
  plateOrChassis: string,
): boolean {
  const normalizedTarget = normalizeIdentifier(plateOrChassis);
  const normalizedPlate = normalizeIdentifier(
    rawEquipment.placa ?? rawEquipment.plate,
  );
  const normalizedChassis = normalizeIdentifier(
    rawEquipment.chassis ?? rawEquipment.chassi,
  );
  const normalizedPatrimonioBase = normalizeIdentifier(
    rawEquipment.patrimonioBase,
  );

  return (
    normalizedTarget.length > 0 &&
    (normalizedTarget === normalizedPlate ||
      normalizedTarget === normalizedChassis ||
      normalizedTarget === normalizedPatrimonioBase)
  );
}

export function isSupportedMeasurementType(
  value: string,
): value is TipoMedicao {
  return value === 'horimetro' || value === 'hodometro';
}

/**
 * Maior `currentReading` entre os abastecimentos do mesmo equipamento (já
 * filtrados por `equipmentId` na query), considerando só a mesma prefeitura e o
 * mesmo tipo de medição (horímetro/hodômetro não se comparam). `null` se nenhum
 * — aí não há leitura anterior e qualquer valor é aceito. Pura — testável.
 */
export function maiorLeituraRegistrada(
  docs: {
    prefeituraId?: string;
    measurementType?: string;
    currentReading?: unknown;
  }[],
  prefeituraId: string,
  measurementType: string,
): number | null {
  let max: number | null = null;
  for (const doc of docs) {
    if (doc.prefeituraId !== prefeituraId) continue;
    if (doc.measurementType !== measurementType) continue;
    const r = Number(doc.currentReading);
    if (!Number.isFinite(r)) continue;
    if (max === null || r > max) max = r;
  }
  return max;
}

export function parseLiters(value: number): number | null {
  const liters = Number(value);
  if (!Number.isFinite(liters) || liters <= 0) {
    return null;
  }
  return liters;
}

export function resolveAbastecimentoPricing(
  liters: number,
  pricePerLiter?: number,
  total?: number,
): { pricePerLiter: number | null; total: number | null } {
  const parsedPrice =
    pricePerLiter !== undefined &&
    Number.isFinite(Number(pricePerLiter)) &&
    Number(pricePerLiter) >= 0
      ? Number(pricePerLiter)
      : null;
  const parsedTotal =
    total !== undefined && Number.isFinite(Number(total)) && Number(total) >= 0
      ? Number(total)
      : null;

  if (parsedPrice !== null && parsedTotal !== null) {
    return {
      pricePerLiter: parsedPrice,
      total: roundCurrency(parsedTotal),
    };
  }
  if (parsedPrice !== null) {
    return {
      pricePerLiter: parsedPrice,
      total: roundCurrency(liters * parsedPrice),
    };
  }
  if (parsedTotal !== null) {
    return {
      pricePerLiter: liters > 0 ? roundRate(parsedTotal / liters) : null,
      total: roundCurrency(parsedTotal),
    };
  }
  return { pricePerLiter: null, total: null };
}

function roundCurrency(value: number): number {
  return Math.round(value * 100) / 100;
}

function roundRate(value: number): number {
  return Math.round(value * 10000) / 10000;
}
