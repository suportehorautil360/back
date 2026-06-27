import type { GarantiaListItem, GarantiaResumoEquipamento } from '../garantias.types';
import { parseHorimetro } from './parse-horimetro.helper';

function texto(valor: unknown): string {
  return typeof valor === 'string' ? valor.trim() : '';
}

export type FiltrosGarantiaQuery = {
  horimetroAtual?: string;
  status?: string;
  tipo?: string;
  busca?: string;
};

export function parseHorimetroQuery(raw?: string): number | null {
  return raw ? parseHorimetro(raw) : null;
}

export function chaveGarantiaUnica(linha: {
  checklistDevolucaoId?: string;
  tipo: string;
  item: string;
}): string {
  const chd = texto(linha.checklistDevolucaoId) || '_';
  return `${chd}|${linha.tipo}|${linha.item.toLowerCase()}`;
}

export function mesclarLinhasGarantia(
  persistidas: GarantiaListItem[],
  derivadasChd: GarantiaListItem[],
): GarantiaListItem[] {
  const map = new Map<string, GarantiaListItem>();

  for (const linha of derivadasChd) {
    map.set(chaveGarantiaUnica(linha), linha);
  }
  for (const linha of persistidas) {
    map.set(chaveGarantiaUnica(linha), linha);
  }

  return [...map.values()].sort((a, b) => {
    const da = a.venceEmIso || a.dataExec;
    const db = b.venceEmIso || b.dataExec;
    return db.localeCompare(da);
  });
}

export function aplicarFiltrosGarantia(
  linhas: GarantiaListItem[],
  query: FiltrosGarantiaQuery,
): GarantiaListItem[] {
  let out = linhas;

  const statusFiltro = texto(query.status).toLowerCase();
  if (statusFiltro && statusFiltro !== 'todos') {
    out = out.filter((l) => l.status === statusFiltro);
  }

  const tipoFiltro = texto(query.tipo).toLowerCase();
  if (tipoFiltro && tipoFiltro !== 'todos') {
    out = out.filter((l) => l.tipo === tipoFiltro);
  }

  const busca = texto(query.busca).toLowerCase();
  if (busca) {
    out = out.filter(
      (l) =>
        l.osOrigem.toLowerCase().includes(busca) ||
        l.item.toLowerCase().includes(busca) ||
        l.fornecedor.toLowerCase().includes(busca),
    );
  }

  return out;
}

export function montarResumoGarantia(params: {
  equipamentoId: string;
  equipamento: string;
  horimetroAtual: number | null;
  linhas: GarantiaListItem[];
}): GarantiaResumoEquipamento {
  return {
    equipamentoId: params.equipamentoId,
    equipamento: params.equipamento,
    horimetroAtual: params.horimetroAtual,
    itensEmGarantia: params.linhas.filter((l) => l.status === 'vigente').length,
    prestesAVencer: params.linhas.filter((l) => l.status === 'vencendo').length,
  };
}
