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

export function parseLiters(value: number): number | null {
  const liters = Number(value);
  if (!Number.isFinite(liters) || liters <= 0) {
    return null;
  }
  return liters;
}
