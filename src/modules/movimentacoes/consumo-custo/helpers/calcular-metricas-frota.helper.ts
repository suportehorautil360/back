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

function normalizarTextoEquipamento(value: unknown): string {
  if (value === null || value === undefined) return '';
  const texto = String(value).trim();
  if (!texto) return '';
  return texto
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

/** Infere horímetro a partir de tipo/linha/descrição quando `unidadeRevisao` não veio. */
export function tipoMedidaFromEquipamento(
  equipment: Record<string, unknown>,
): TipoMedidaFrota | null {
  const texto = [
    equipment.tipo,
    equipment.linha,
    equipment.descricao,
    equipment.label,
    equipment.nome,
  ]
    .map(normalizarTextoEquipamento)
    .filter(Boolean)
    .join(' ');

  if (!texto) return null;

  if (
    texto.includes('linha amarela') ||
    texto.includes('maquina') ||
    /escav|retro|trator|carregadeira|rolo|motonivel|patrola|pa carreg|guindaste|miniescav|compactador/.test(
      texto,
    )
  ) {
    return 'HORA';
  }

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
