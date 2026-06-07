import { formatBRL } from '../../postos/helpers/postos-list.helper';
import type { CreditoDoc, CreditoSaldosPayload } from '../creditos.types';
import { resolveEquipmentPlateOrChassis } from './creditos-create.helper';

interface AllocationSnapshot {
  vehicleId: string;
  workFrontId: string;
  workFrontName: string;
}

interface AbastecimentoGastoInput {
  equipmentId: string;
  total: number | null;
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

function buildSaldoLabels(creditado: number, gasto: number) {
  const saldo = roundMoney(creditado - gasto);
  return {
    saldo,
    saldoLabel: formatBRL(saldo),
    creditadoLabel: formatBRL(creditado),
    gastoLabel: formatBRL(gasto),
  };
}

function resolveEquipmentIdentity(
  equipmentId: string,
  equipment: Record<string, unknown> | undefined,
  plateOrChassis?: string | null,
): { placa: string; nome: string } {
  const placa =
    resolveEquipmentPlateOrChassis(equipment ?? {}) ||
    asString(plateOrChassis) ||
    equipmentId;
  const nome =
    asString(equipment?.descricao ?? equipment?.label ?? equipment?.nome) ||
    placa;

  return { placa, nome };
}

function resolveEquipmentLocal(
  equipmentId: string,
  equipment: Record<string, unknown> | undefined,
  allocationByVehicle: Map<string, AllocationSnapshot>,
): string {
  const allocation = allocationByVehicle.get(equipmentId);
  if (allocation?.workFrontName) {
    return allocation.workFrontName;
  }

  return (
    asString(equipment?.obra ?? equipment?.centroCusto ?? equipment?.local) ||
    '—'
  );
}

export function buildCreditosSaldosPayload(input: {
  creditos: CreditoDoc[];
  abastecimentos: AbastecimentoGastoInput[];
  allocations: AllocationSnapshot[];
  equipmentMap: Map<string, Record<string, unknown>>;
  workFrontNames: Map<string, string>;
}): CreditoSaldosPayload {
  const creditoPorEquipamento = new Map<string, number>();
  const creditoPorFrente = new Map<string, number>();
  const gastoPorEquipamento = new Map<string, number>();
  const gastoPorFrente = new Map<string, number>();
  const allocationByVehicle = new Map<string, AllocationSnapshot>();
  const equipmentMeta = new Map<
    string,
    { plateOrChassis: string | null; equipmentId: string }
  >();

  for (const allocation of input.allocations) {
    allocationByVehicle.set(allocation.vehicleId, allocation);
  }

  for (const credito of input.creditos) {
    if (credito.type === 'equipment') {
      const key = resolveEquipmentKey(
        credito.equipmentId,
        credito.plateOrChassis,
        input.equipmentMap,
      );
      if (!key) continue;

      creditoPorEquipamento.set(
        key,
        roundMoney((creditoPorEquipamento.get(key) ?? 0) + credito.amount),
      );
      equipmentMeta.set(key, {
        equipmentId: credito.equipmentId ?? key,
        plateOrChassis: credito.plateOrChassis,
      });
      continue;
    }

    if (!credito.workFrontId) continue;
    creditoPorFrente.set(
      credito.workFrontId,
      roundMoney(
        (creditoPorFrente.get(credito.workFrontId) ?? 0) + credito.amount,
      ),
    );
  }

  for (const abastecimento of input.abastecimentos) {
    const gasto = abastecimento.total ?? 0;
    if (gasto <= 0 || !abastecimento.equipmentId) continue;

    gastoPorEquipamento.set(
      abastecimento.equipmentId,
      roundMoney(
        (gastoPorEquipamento.get(abastecimento.equipmentId) ?? 0) + gasto,
      ),
    );

    const allocation = allocationByVehicle.get(abastecimento.equipmentId);
    if (!allocation?.workFrontId) continue;

    gastoPorFrente.set(
      allocation.workFrontId,
      roundMoney((gastoPorFrente.get(allocation.workFrontId) ?? 0) + gasto),
    );
  }

  const equipmentKeys = new Set([
    ...creditoPorEquipamento.keys(),
    ...gastoPorEquipamento.keys(),
  ]);

  const saldosEquipamento = [...equipmentKeys]
    .map((key) => {
      const creditado = creditoPorEquipamento.get(key) ?? 0;
      const gasto = gastoPorEquipamento.get(key) ?? 0;
      const meta = equipmentMeta.get(key);
      const equipmentId = meta?.equipmentId ?? key;
      const equipment = input.equipmentMap.get(equipmentId);
      const { placa, nome } = resolveEquipmentIdentity(
        equipmentId,
        equipment,
        meta?.plateOrChassis,
      );

      return {
        id: equipmentId,
        placa,
        nome,
        local: resolveEquipmentLocal(
          equipmentId,
          equipment,
          allocationByVehicle,
        ),
        creditado,
        gasto,
        ...buildSaldoLabels(creditado, gasto),
      };
    })
    .filter((item) => item.creditado > 0 || item.gasto > 0)
    .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));

  const frenteKeys = new Set([
    ...creditoPorFrente.keys(),
    ...gastoPorFrente.keys(),
  ]);

  const saldosFrente = [...frenteKeys]
    .map((workFrontId) => {
      const creditado = creditoPorFrente.get(workFrontId) ?? 0;
      const gasto = gastoPorFrente.get(workFrontId) ?? 0;

      return {
        id: workFrontId,
        nome: input.workFrontNames.get(workFrontId) ?? 'Frente de trabalho',
        creditado,
        gasto,
        ...buildSaldoLabels(creditado, gasto),
      };
    })
    .filter((item) => item.creditado > 0 || item.gasto > 0)
    .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));

  return { saldosEquipamento, saldosFrente };
}

function resolveEquipmentKey(
  equipmentId: string | null,
  plateOrChassis: string | null,
  equipmentMap: Map<string, Record<string, unknown>>,
): string | null {
  if (equipmentId) return equipmentId;
  if (!plateOrChassis) return null;

  const normalizedTarget = normalizeIdentifier(plateOrChassis);
  for (const [id, raw] of equipmentMap.entries()) {
    const candidates = [
      resolveEquipmentPlateOrChassis(raw),
      asString(raw.id ?? id),
      id,
    ];
    if (
      candidates.some(
        (candidate) =>
          normalizeIdentifier(candidate) === normalizedTarget &&
          normalizedTarget.length > 0,
      )
    ) {
      return id;
    }
  }

  return plateOrChassis;
}

function normalizeIdentifier(value: string): string {
  return value
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

function asString(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return '';
}
