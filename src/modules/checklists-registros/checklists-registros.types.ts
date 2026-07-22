export interface ChecklistRegistroItemNao {
  titulo?: string;
  problema?: string;
  numero?: string;
  /** Item impeditivo reprovado — triagem classifica como risco alto. */
  impeditivo?: boolean;
}

export interface ChecklistRegistroDoc {
  id: string;
  dataHoraIso: string;
  operador: string;
  chassis: string;
  categoria: string;
  modelo: string;
  linha: string;
  totalItens: number;
  totalSim: number;
  /** Contagem real de respostas "Não" (não inclui N/A). */
  totalNao: number;
  totalNa: number;
  totalAplicaveis: number;
  pontuacao: number;
  horimetro: string;
  assinaturaOperador: string;
  respostas: Record<string, unknown> | string;
  obs: string | null;
  localizacaoGps: unknown;
  prefeituraId: string;
  idOperadorSession: string;
  itensNao: ChecklistRegistroItemNao[];
}

export interface TopOperadorChecklist {
  nome: string;
  total: number;
}

export interface ChecklistRegistroResumoPainel {
  mes: string;
  totalGeral: number;
  totalNoMes: number;
  checklistsPorSemana: number[];
  topOperadores: TopOperadorChecklist[];
}
