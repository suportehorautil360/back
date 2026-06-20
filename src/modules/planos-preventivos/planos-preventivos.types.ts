export const ACOES_MATRIZ = [
  'na',
  'inspecionar',
  'trocar',
  'limpar',
  'lubrificar',
  'coletar',
  'medir_trocar',
  'se_necessario',
  'opcional',
] as const;

export type AcaoMatriz = (typeof ACOES_MATRIZ)[number];

export interface CicloMatriz {
  id: string;
  horas: number;
  km: number;
  titulo: string;
}

export interface LinhaMatriz {
  id: string;
  categoria: string;
  item: string;
  especificacao: string;
  acoes: Record<string, AcaoMatriz>;
}

export interface PlanoPreventivoDoc {
  prefeituraId: string;
  ciclos: CicloMatriz[];
  linhas: LinhaMatriz[];
  atualizadoEm: string;
}

export interface SalvarPlanoPreventivoInput {
  ciclos: CicloMatriz[];
  linhas: LinhaMatriz[];
}
