/**
 * Regras de consumo/custo — Especificação Técnica V2 (HoraÚtil360).
 * Consumo = litros do abastecimento atual ÷ (leitura atual − leitura anterior).
 * Gasto = litros × preço/l (quando informado). Custo unitário = consumo × preço/l.
 */

export type TipoMedidaFrota = 'KM' | 'HORA';

export interface MetricasIntervaloFrota {
  deltaTrabalho: number;
  consumoMedio: number;
  gastoTotal: number | null;
  custoUnitario: number | null;
  sufixoConsumo: 'L/km' | 'L/h';
  sufixoCusto: 'R$/km' | 'R$/h';
}

export interface EntradaMetricasIntervalo {
  tipoMedida: TipoMedidaFrota;
  litrosAbastecidos: number;
  leituraAtual: number;
  leituraAnterior: number;
  precoLitro?: number | null;
}

export function tipoMedidaFromUnidadeRevisao(
  unidade: unknown,
): TipoMedidaFrota | null {
  if (unidade === 'h') return 'HORA';
  if (unidade === 'km') return 'KM';
  return null;
}

export function tipoMedidaFromMeasurementType(
  measurementType: unknown,
): TipoMedidaFrota | null {
  if (measurementType === 'horimetro') return 'HORA';
  if (measurementType === 'hodometro') return 'KM';
  return null;
}

export function resolvePrecoLitro(
  litros: number,
  pricePerLiter?: number | null,
  total?: number | null,
): number | null {
  if (pricePerLiter != null && Number.isFinite(pricePerLiter) && pricePerLiter > 0) {
    return pricePerLiter;
  }
  if (
    total != null &&
    Number.isFinite(total) &&
    total > 0 &&
    litros > 0
  ) {
    return total / litros;
  }
  return null;
}

export function resolveGastoAbastecimento(
  litros: number,
  pricePerLiter?: number | null,
  total?: number | null,
): number | null {
  const preco = resolvePrecoLitro(litros, pricePerLiter, total);
  if (preco == null) return null;
  return Math.round(litros * preco * 100) / 100;
}

/** Calcula métricas de um intervalo; retorna null se ΔTrabalho ≤ 0. */
export function calcularMetricasIntervalo(
  dados: EntradaMetricasIntervalo,
): MetricasIntervaloFrota | null {
  const deltaTrabalho = dados.leituraAtual - dados.leituraAnterior;
  if (deltaTrabalho <= 0) return null;

  const porHora = dados.tipoMedida === 'HORA';
  const consumoMedio = dados.litrosAbastecidos / deltaTrabalho;
  const precoLitro = resolvePrecoLitro(
    dados.litrosAbastecidos,
    dados.precoLitro,
  );

  let gastoTotal: number | null = null;
  let custoUnitario: number | null = null;

  if (precoLitro != null && precoLitro > 0) {
    gastoTotal = Math.round(dados.litrosAbastecidos * precoLitro * 100) / 100;
    custoUnitario = consumoMedio * precoLitro;
  }

  return {
    deltaTrabalho,
    consumoMedio,
    gastoTotal,
    custoUnitario,
    sufixoConsumo: porHora ? 'L/h' : 'L/km',
    sufixoCusto: porHora ? 'R$/h' : 'R$/km',
  };
}
