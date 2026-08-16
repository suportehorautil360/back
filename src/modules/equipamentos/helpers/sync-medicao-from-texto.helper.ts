import { parseHorimetro } from '../../garantias/helpers/parse-horimetro.helper';
import { deveAtualizarMedicaoAtual } from '../../movimentacoes/abastecimentos/helpers/abastecimentos-create.helper';

export type MedicaoChecklistTexto = {
  hourMeter?: string;
  km?: string;
};

/**
 * Escolhe a leitura numérica e o tipo de medição a partir dos campos de
 * identificação do checklist (CHE/CHD ou campo).
 */
export function resolverLeituraChecklist(
  campos: MedicaoChecklistTexto,
): { measurementType: 'horimetro' | 'hodometro'; leitura: number } | null {
  const horas = parseHorimetro(campos.hourMeter);
  if (horas != null && horas >= 0) {
    return { measurementType: 'horimetro', leitura: horas };
  }
  const km = parseHorimetro(campos.km);
  if (km != null && km >= 0) {
    return { measurementType: 'hodometro', leitura: km };
  }
  return null;
}

/**
 * Decide se a leitura do checklist deve atualizar `medicaoAtual` do equipamento.
 * Pura — testável.
 */
export function deveAplicarMedicaoChecklist(
  equipamento: Record<string, unknown>,
  measurementType: 'horimetro' | 'hodometro',
  leituraNova: number,
): boolean {
  if (!Number.isFinite(leituraNova) || leituraNova < 0) return false;
  return deveAtualizarMedicaoAtual(
    equipamento.unidadeRevisao,
    measurementType,
    equipamento.medicaoAtual ?? equipamento.currentMeter,
    leituraNova,
  );
}

/**
 * Escolhe horímetro ou hodômetro conforme a unidade do equipamento.
 * Evita rejeitar "87000" em veículo km porque veio do campo horímetro do PWA.
 */
export function resolverLeituraParaUnidade(
  leituraTexto: string,
  unidadeRevisao: unknown,
): { measurementType: 'horimetro' | 'hodometro'; leitura: number } | null {
  const txt = leituraTexto.trim();
  if (!txt) return null;
  const un =
    unidadeRevisao === 'km' ? 'km' : unidadeRevisao === 'h' ? 'h' : null;
  if (un === 'km') return resolverLeituraChecklist({ km: txt });
  if (un === 'h') return resolverLeituraChecklist({ hourMeter: txt });
  return (
    resolverLeituraChecklist({ km: txt }) ??
    resolverLeituraChecklist({ hourMeter: txt })
  );
}
