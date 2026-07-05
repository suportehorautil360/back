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
  TipoMedidaFrota,
  UnidadeMedicao,
} from '../consumo-custo.types';
import {
  calcularMetricasIntervalo,
  resolveGastoAbastecimento,
  tipoMedidaFromEquipamento,
  tipoMedidaFromMeasurementType,
  tipoMedidaFromUnidadeRevisao,
} from './calcular-metricas-frota.helper';

export const CALCULO_INFO: ConsumoCustoCalculoInfo = {
  titulo: 'Como o consumo e o custo são calculados',
  formulaConsumo:
    'Veículos: L/km = litros ÷ km rodados. Máquinas: L/h = litros ÷ horas de uso (horímetro).',
  formulaCusto:
    'Quando há preço por litro, o gasto = litros × preço/l e o custo unitário = consumo médio × preço/l.',
  observacao:
    'Máquinas (Linha Amarela / horímetro) exibem litros por hora. Carros e caminhões usam litros por km. Em campo, o consumo usa os litros do reabastecimento que completa o tanque.',
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

export function resolveTipoMedidaEquipamento(
  equipment: Record<string, unknown>,
  abastecimentos: AbastecimentoConsumoInput[],
): TipoMedidaFrota {
  const fromEquip = tipoMedidaFromUnidadeRevisao(equipment.unidadeRevisao);
  if (fromEquip) return fromEquip;

  const fromPerfil = tipoMedidaFromEquipamento(equipment);
  if (fromPerfil) return fromPerfil;

  for (let i = abastecimentos.length - 1; i >= 0; i -= 1) {
    const fromAbast = tipoMedidaFromMeasurementType(
      abastecimentos[i].measurementType,
    );
    if (fromAbast) return fromAbast;
  }

  return 'KM';
}

export function tipoMedidaToInterno(tipo: TipoMedidaFrota): TipoMedicaoInterno {
  return tipo === 'HORA' ? 'horimetro' : 'hodometro';
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
    .map((item) => {
      const gasto =
        resolveGastoAbastecimento(
          item.liters,
          item.pricePerLiter,
          item.total,
        ) ?? item.total;

      return {
        id: item.id,
        dateTime: formatDateTime(item.createdAt),
        litros: item.liters,
        litrosLabel: formatLitros(item.liters),
        leituraLabel:
          item.currentReading != null
            ? `${item.currentReading.toLocaleString('pt-BR')} ${unit}`
            : '—',
        currentReading: item.currentReading,
        gasto: gasto ?? null,
        gastoLabel: gasto !== null ? formatBRL(gasto) : '—',
        pricePerLiter: item.pricePerLiter ?? null,
        postoId: item.postoId ?? null,
        createdAt: item.createdAt,
      };
    });
}

function findPreviousValidReading(
  ordered: AbastecimentoConsumoInput[],
  beforeIndex: number,
): { reading: number; item: AbastecimentoConsumoInput } | null {
  for (let j = beforeIndex - 1; j >= 0; j -= 1) {
    const reading = ordered[j].currentReading;
    if (reading != null && Number.isFinite(reading)) {
      return { reading, item: ordered[j] };
    }
  }
  return null;
}

function buildIntervalosConsumo(
  ordered: AbastecimentoConsumoInput[],
  startIso: string | undefined,
  endIso: string | undefined,
  tipoMedida: TipoMedidaFrota,
  unit: UnidadeMedicao,
): {
  historicoIntervalos: ConsumoCustoIntervalo[];
  totalDistanciaPeriodo: number;
  totalLitrosIntervalos: number;
  totalGastoIntervalos: number;
} {
  const historicoIntervalos: ConsumoCustoIntervalo[] = [];
  let totalDistanciaPeriodo = 0;
  let totalLitrosIntervalos = 0;
  let totalGastoIntervalos = 0;
  let litrosAcumulados = 0;
  let gastoAcumulado = 0;
  let temGastoAcumulado = false;
  let chainStart: AbastecimentoConsumoInput | null = null;

  for (let i = 0; i < ordered.length; i += 1) {
    const current = ordered[i];
    const currReading = current.currentReading;

    if (chainStart === null && currReading != null) {
      chainStart = current;
    }

    if (!isWithinPeriod(current.createdAt, startIso, endIso)) {
      if (currReading != null) {
        chainStart = current;
        litrosAcumulados = 0;
        gastoAcumulado = 0;
        temGastoAcumulado = false;
      } else {
        litrosAcumulados += current.liters;
        const gastoParcial = resolveGastoAbastecimento(
          current.liters,
          current.pricePerLiter,
          current.total,
        );
        if (gastoParcial != null) {
          gastoAcumulado += gastoParcial;
          temGastoAcumulado = true;
        }
      }
      continue;
    }

    const prev = findPreviousValidReading(ordered, i);
    if (currReading == null) {
      litrosAcumulados += current.liters;
      const gastoParcial = resolveGastoAbastecimento(
        current.liters,
        current.pricePerLiter,
        current.total,
      );
      if (gastoParcial != null) {
        gastoAcumulado += gastoParcial;
        temGastoAcumulado = true;
      }
      continue;
    }

    if (prev == null) {
      chainStart = current;
      continue;
    }

    const litros = current.liters + litrosAcumulados;
    const gastoParcialAtual = resolveGastoAbastecimento(
      current.liters,
      current.pricePerLiter,
      current.total,
    );
    const gastoIntervaloBruto =
      temGastoAcumulado || gastoParcialAtual != null
        ? gastoAcumulado + (gastoParcialAtual ?? 0)
        : null;

    const metricas = calcularMetricasIntervalo({
      tipoMedida,
      litrosAbastecidos: litros,
      leituraAtual: currReading,
      leituraAnterior: prev.reading,
      precoLitro:
        litros > 0 && gastoIntervaloBruto != null
          ? gastoIntervaloBruto / litros
          : current.pricePerLiter,
    });

    litrosAcumulados = 0;
    gastoAcumulado = 0;
    temGastoAcumulado = false;

    if (metricas == null) {
      chainStart = current;
      continue;
    }

    totalDistanciaPeriodo += metricas.deltaTrabalho;
    totalLitrosIntervalos += litros;
    if (metricas.gastoTotal != null) {
      totalGastoIntervalos += metricas.gastoTotal;
    }

    const inicio =
      chainStart && chainStart.id !== current.id ? chainStart : prev.item;

    historicoIntervalos.push({
      periodoLabel: `${formatDateTime(inicio.createdAt)} → ${formatDateTime(current.createdAt)}`,
      distanciaLabel: `${formatDecimal(metricas.deltaTrabalho, metricas.deltaTrabalho % 1 === 0 ? 0 : 1)} ${unit}`,
      consumoLabel: formatConsumoUnit(metricas.consumoMedio, unit),
      custoLabel: formatCustoUnit(metricas.custoUnitario, unit),
    });

    chainStart = current;
  }

  historicoIntervalos.reverse();

  return {
    historicoIntervalos,
    totalDistanciaPeriodo,
    totalLitrosIntervalos,
    totalGastoIntervalos,
  };
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

  const tipoMedida = resolveTipoMedidaEquipamento(equipment, ordered);
  const measurementType = tipoMedidaToInterno(tipoMedida);
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

  const {
    historicoIntervalos,
    totalDistanciaPeriodo,
    totalLitrosIntervalos,
    totalGastoIntervalos,
  } = buildIntervalosConsumo(ordered, startIso, endIso, tipoMedida, unit);

  const mediaConsumo =
    totalDistanciaPeriodo > 0
      ? totalLitrosIntervalos / totalDistanciaPeriodo
      : null;
  const mediaCusto =
    totalDistanciaPeriodo > 0 &&
    totalGastoIntervalos > 0 &&
    mediaConsumo != null
      ? mediaConsumo * (totalGastoIntervalos / totalLitrosIntervalos)
      : null;

  const temCusto = totalGastoIntervalos > 0;
  const totalDestaque = temCusto
    ? {
        tipo: 'gasto' as const,
        rotulo: 'GASTO TOTAL',
        valor: totalGastoIntervalos,
        valorExibicao: formatBRL(totalGastoIntervalos),
      }
    : {
        tipo: 'litros' as const,
        rotulo: 'LITROS TOTAL',
        valor: totalLitrosIntervalos,
        valorExibicao: formatLitros(totalLitrosIntervalos),
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
      litros: totalLitrosIntervalos,
      litrosExibicao: formatLitros(totalLitrosIntervalos),
      gasto: totalGastoIntervalos,
      gastoExibicao: formatBRL(totalGastoIntervalos),
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
