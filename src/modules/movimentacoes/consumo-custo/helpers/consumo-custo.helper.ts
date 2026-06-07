import { formatDateTime } from '../../shared/date.helper';
import {
  formatBRL,
  formatLitros,
} from '../../postos/helpers/postos-list.helper';
import type {
  AbastecimentoConsumoInput,
  ConsumoCustoAbastecimentoHistorico,
  ConsumoCustoCalculoInfo,
  ConsumoCustoIntervalo,
  ConsumoCustoPayload,
  ConsumoCustoPeriodo,
  ConsumoCustoVeiculoCard,
  MeasurementTypeResponse,
  TipoMedicaoInterno,
  UnidadeMedicao,
} from '../consumo-custo.types';

export const CALCULO_INFO: ConsumoCustoCalculoInfo = {
  titulo: 'Como o consumo e o custo são calculados',
  formulaConsumo:
    'Consumo = litros do abastecimento ÷ (leitura atual − leitura anterior)',
  formulaCusto:
    'Quando o abastecimento tem valor (R$), o sistema calcula também o custo por km ou hora rodada.',
  observacao: 'Válido para carros, caminhões e máquinas pesadas.',
};

export function measurementUnit(
  measurementType: TipoMedicaoInterno,
): UnidadeMedicao {
  return measurementType === 'horimetro' ? 'h' : 'km';
}

export function toResponseMeasurementType(
  measurementType: TipoMedicaoInterno,
): MeasurementTypeResponse {
  return measurementType === 'horimetro' ? 'horimetro' : 'odometro';
}

export function isWithinPeriod(
  createdAt: string,
  startIso?: string,
  endIso?: string,
): boolean {
  if (startIso && createdAt < startIso) return false;
  if (endIso && createdAt > endIso) return false;
  return true;
}

export function formatPeriodoLabel(
  startDate?: string,
  endDate?: string,
): string {
  if (!startDate && !endDate) return 'Todo o período';

  const formatDay = (value: string) => {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();
    return `${day}/${month}/${year}`;
  };

  if (startDate && endDate) {
    return `${formatDay(startDate)} — ${formatDay(endDate)}`;
  }
  if (startDate) return `A partir de ${formatDay(startDate)}`;
  return `Até ${formatDay(endDate!)}`;
}

export function buildConsumoCustoPayload(
  veiculos: ConsumoCustoVeiculoCard[],
  periodo: ConsumoCustoPeriodo,
): ConsumoCustoPayload {
  return {
    titulo: 'Consumo & Custo por Veículo',
    periodo,
    calculo: CALCULO_INFO,
    veiculos,
  };
}

function formatDecimal(value: number, digits = 2): string {
  return value.toLocaleString('pt-BR', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function formatConsumoUnit(value: number | null, unit: UnidadeMedicao): string {
  if (value === null) return '—';
  return `${formatDecimal(value)} L/${unit}`;
}

function formatCustoUnit(value: number | null, unit: UnidadeMedicao): string {
  if (value === null) return '—';
  return `${formatBRL(value)}/${unit}`;
}

function buildSubtitulo(placa: string, tipo: string, setor: string): string {
  const parts = [placa, tipo, setor].filter((part) => part && part !== '—');
  return parts.join(' · ');
}

function buildHistoricoAbastecimentos(
  abastecimentos: AbastecimentoConsumoInput[],
  unit: UnidadeMedicao,
): ConsumoCustoAbastecimentoHistorico[] {
  return [...abastecimentos]
    .sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    )
    .map((item) => ({
      id: item.id,
      dateTime: formatDateTime(item.createdAt),
      litros: item.liters,
      litrosLabel: formatLitros(item.liters),
      leituraLabel: `${item.currentReading.toLocaleString('pt-BR')} ${unit}`,
      currentReading: item.currentReading,
      gasto: item.total,
      gastoLabel: item.total !== null ? formatBRL(item.total) : '—',
      pricePerLiter: item.pricePerLiter ?? null,
      postoId: item.postoId ?? null,
      createdAt: item.createdAt,
    }));
}

function resolveVehicleIdentity(
  equipment: Record<string, unknown>,
  plateOrChassis: string,
): { nome: string; placa: string; tipo: string; setor: string } {
  const placa = asString(
    equipment.placa ?? equipment.chassis ?? equipment.chassi ?? plateOrChassis,
  );
  const nome = asString(
    equipment.descricao ?? equipment.label ?? equipment.nome ?? placa,
  );
  const tipo = asString(equipment.tipo ?? equipment.linha ?? '—') || '—';
  const setor =
    asString(equipment.obra ?? equipment.centroCusto ?? equipment.local) || '—';

  return {
    nome: nome || placa || 'Equipamento',
    placa: placa || plateOrChassis || '—',
    tipo,
    setor,
  };
}

export function buildVeiculoCard(
  equipmentId: string,
  abastecimentos: AbastecimentoConsumoInput[],
  equipment: Record<string, unknown>,
  startIso?: string,
  endIso?: string,
): ConsumoCustoVeiculoCard | null {
  const ordered = [...abastecimentos].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  );

  const abastecimentosNoPeriodo = ordered.filter((item) =>
    isWithinPeriod(item.createdAt, startIso, endIso),
  );

  if (abastecimentosNoPeriodo.length === 0) {
    return null;
  }

  const measurementType =
    abastecimentosNoPeriodo[abastecimentosNoPeriodo.length - 1]
      ?.measurementType ??
    ordered[ordered.length - 1]?.measurementType ??
    'hodometro';
  const unit = measurementUnit(measurementType);
  const consumoRotulo = unit === 'h' ? 'MÉDIO L/H' : 'MÉDIO L/KM';
  const custoRotulo = unit === 'h' ? 'CUSTO /H' : 'CUSTO /KM';

  const plateOrChassis =
    abastecimentosNoPeriodo[abastecimentosNoPeriodo.length - 1]
      ?.plateOrChassis ??
    ordered[ordered.length - 1]?.plateOrChassis ??
    '';
  const { nome, placa, tipo, setor } = resolveVehicleIdentity(
    equipment,
    plateOrChassis,
  );

  const historicoIntervalos: ConsumoCustoIntervalo[] = [];
  let totalLitrosPeriodo = 0;
  let totalGastoPeriodo = 0;
  let totalDistanciaPeriodo = 0;
  let totalLitrosIntervalos = 0;
  let totalGastoIntervalos = 0;

  for (const item of abastecimentosNoPeriodo) {
    totalLitrosPeriodo += item.liters;
    totalGastoPeriodo += item.total ?? 0;
  }

  for (let index = 1; index < ordered.length; index += 1) {
    const previous = ordered[index - 1];
    const current = ordered[index];
    if (!isWithinPeriod(current.createdAt, startIso, endIso)) continue;

    const distancia = current.currentReading - previous.currentReading;
    if (distancia <= 0) continue;

    const consumo = current.liters / distancia;
    const gasto = current.total;
    const custo = gasto !== null && gasto > 0 ? gasto / distancia : null;

    totalDistanciaPeriodo += distancia;
    totalLitrosIntervalos += current.liters;
    if (gasto !== null && gasto > 0) {
      totalGastoIntervalos += gasto;
    }

    historicoIntervalos.push({
      periodoLabel: `${formatDateTime(previous.createdAt)} → ${formatDateTime(current.createdAt)}`,
      distanciaLabel: `${formatDecimal(distancia, distancia % 1 === 0 ? 0 : 1)} ${unit}`,
      consumoLabel: formatConsumoUnit(consumo, unit),
      custoLabel: formatCustoUnit(custo, unit),
    });
  }

  historicoIntervalos.reverse();

  const mediaConsumo =
    totalDistanciaPeriodo > 0
      ? totalLitrosIntervalos / totalDistanciaPeriodo
      : null;
  const mediaCusto =
    totalDistanciaPeriodo > 0 && totalGastoIntervalos > 0
      ? totalGastoIntervalos / totalDistanciaPeriodo
      : null;

  const temCusto = totalGastoPeriodo > 0;
  const totalDestaque = temCusto
    ? {
        tipo: 'gasto' as const,
        rotulo: 'GASTO TOTAL',
        valor: totalGastoPeriodo,
        valorExibicao: formatBRL(totalGastoPeriodo),
      }
    : {
        tipo: 'litros' as const,
        rotulo: 'LITROS TOTAL',
        valor: totalLitrosPeriodo,
        valorExibicao: formatLitros(totalLitrosPeriodo),
      };

  return {
    equipmentId,
    nome,
    placa,
    tipo,
    setor,
    subtitulo: buildSubtitulo(placa, tipo, setor),
    measurementType: toResponseMeasurementType(measurementType),
    unidadeMedicao: unit,
    temCusto,
    consumoMedio: {
      rotulo: consumoRotulo,
      valor: mediaConsumo,
      valorExibicao: formatConsumoUnit(mediaConsumo, unit),
    },
    custoMedio: {
      rotulo: custoRotulo,
      valor: mediaCusto,
      valorExibicao: formatCustoUnit(mediaCusto, unit),
    },
    totalDestaque,
    totais: {
      litros: totalLitrosPeriodo,
      litrosExibicao: formatLitros(totalLitrosPeriodo),
      gasto: totalGastoPeriodo,
      gastoExibicao: formatBRL(totalGastoPeriodo),
    },
    historicoIntervalos,
    historicoAbastecimentos: buildHistoricoAbastecimentos(
      abastecimentosNoPeriodo,
      unit,
    ),
  };
}

function asString(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return '';
}
