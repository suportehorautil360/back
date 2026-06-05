import type { MovimentacaoTipo } from '../movimentacoes.types';

/** Um item de linha na lista do histórico. */
export interface HistoricoItem {
  id: string;
  tipo: MovimentacaoTipo;
  /** Placa ou chassi — exibido em destaque no app. */
  plate: string;
  /** "Escavadeira · 4.812 h" ou "Pá carregadeira · 4 pontos". */
  equipmentLabel: string;
  /** Valor de destaque à direita: "320 L", "engraxe", "500 L". */
  rightLabel: string;
  /** Hora no formato "14:20". */
  time: string;
  createdAt: string;
}

/** Grupo de itens de um mesmo dia. */
export interface HistoricoGroup {
  /** "HOJE · 03 JUN" ou "ONTEM · 02 JUN" ou "01 JUN". */
  dateLabel: string;
  items: HistoricoItem[];
}

/** Cards de resumo exibidos no topo da tela. */
export interface HistoricoSummary {
  totalLitersToday: number;
  totalAbastecimentosToday: number;
  totalEngraxeToday: number;
}

export interface HistoricoResponse {
  summary: HistoricoSummary;
  groups: HistoricoGroup[];
  message: string;
}
