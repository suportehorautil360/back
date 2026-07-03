export interface ChecklistRegistroItemNao {
  titulo?: string;
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
