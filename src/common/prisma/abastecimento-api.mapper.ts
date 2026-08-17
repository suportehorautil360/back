import type { AbastecimentoDoc } from '../../modules/movimentacoes/abastecimentos/abastecimentos.service';
import type { TipoMedicao } from '../../modules/movimentacoes/abastecimentos/dto/create-abastecimento.dto';
import { mapEquipmentToApi } from './equipment-api.mapper';

type AbastecimentoRow = {
  id: string;
  legacyId: string | null;
  companyId: string;
  equipmentId: string | null;
  operadorLegacyId: string | null;
  postoLegacyId: string | null;
  comboioLegacyId: string | null;
  data: Date;
  hora: string | null;
  litros: unknown;
  valor: unknown;
  combustivel: string | null;
  origem: string;
  leitura: number | null;
  leituraUnidade: string | null;
  postoNome: string | null;
  plateOrChassis: string | null;
  precoLitro: unknown;
  status: string;
  tipo: string | null;
  motoristaNome: string | null;
  latitude: number | null;
  longitude: number | null;
  meterPhoto: string | null;
  receiptPhoto: string | null;
  fleetfuelIntencaoId: string | null;
  createdAt: Date;
  equipment?: {
    legacyId?: string | null;
    placa?: string | null;
    chassi?: string | null;
  } | null;
};

function measurementTypeFromRow(row: AbastecimentoRow): TipoMedicao {
  return row.leituraUnidade === 'h' ? 'horimetro' : 'hodometro';
}

function equipmentPublicId(row: AbastecimentoRow): string {
  return row.equipment?.legacyId ?? row.equipmentId ?? '';
}

export function mapAbastecimentoRowToDoc(
  row: AbastecimentoRow,
  prefeituraId: string,
): AbastecimentoDoc {
  const litros = Number(row.litros);
  const valor = Number(row.valor);
  const preco = row.precoLitro != null ? Number(row.precoLitro) : null;

  return {
    id: row.legacyId ?? row.id,
    prefeituraId,
    equipmentId: equipmentPublicId(row),
    plateOrChassis:
      row.plateOrChassis ??
      row.equipment?.placa ??
      row.equipment?.chassi ??
      '',
    liters: Number.isFinite(litros) ? litros : 0,
    tipo: row.tipo ?? (row.origem === 'comboio' ? 'comboio' : 'posto'),
    measurementType: measurementTypeFromRow(row),
    currentReading: row.leitura ?? 0,
    meterPhoto: row.meterPhoto ?? undefined,
    receiptPhoto: row.receiptPhoto ?? undefined,
    pricePerLiter: preco,
    total: Number.isFinite(valor) ? valor : null,
    postoId: row.postoLegacyId ?? undefined,
    comboioId: row.comboioLegacyId ?? undefined,
    funcionarioId: row.operadorLegacyId ?? undefined,
    postoNome: row.postoNome ?? undefined,
    origem: row.origem,
    status: row.status,
    motoristaNome: row.motoristaNome ?? undefined,
    latitude: row.latitude ?? 0,
    longitude: row.longitude ?? 0,
    createdAt: row.createdAt.toISOString(),
  };
}

export function mapAbastecimentoRowsToGastoInput(
  rows: AbastecimentoRow[],
): { equipmentId?: string; total?: unknown; status?: unknown }[] {
  return rows.map((row) => ({
    equipmentId: equipmentPublicId(row),
    total: Number(row.valor),
    status: row.status,
  }));
}

export function mapCreditoRowsToSaldoInput(
  rows: {
    tipo: string;
    equipmentId: string | null;
    plateOrChassis: string | null;
    amount: unknown;
    equipment?: { legacyId: string | null } | null;
  }[],
) {
  return rows.map((row) => ({
    type: row.tipo === 'workFront' ? 'workFront' : 'equipment',
    equipmentId: row.equipment?.legacyId ?? row.equipmentId,
    plateOrChassis: row.plateOrChassis,
    amount: Number(row.amount),
  }));
}

export function equipmentRawFromRow(
  row: NonNullable<Parameters<typeof mapEquipmentToApi>[0]>,
  prefeituraId: string,
): Record<string, unknown> {
  const raw = mapEquipmentToApi(row, prefeituraId) as Record<string, unknown>;
  raw.capacidadeTanqueCaminhao =
    'capacidadeTanqueCaminhao' in row
      ? (row as { capacidadeTanqueCaminhao?: number | null }).capacidadeTanqueCaminhao
      : null;
  return raw;
}
