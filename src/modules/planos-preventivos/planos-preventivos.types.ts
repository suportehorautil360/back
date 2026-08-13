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
  item: string;
  especificacao: string;
  acoes: Record<string, AcaoMatriz>;
}

/** Categoria dona de uma matriz (ciclos × linhas). */
export interface CategoriaPlano {
  id: string;
  nome: string;
  ciclos: CicloMatriz[];
  linhas: LinhaMatriz[];
}

export interface PlanoPreventivoDoc {
  prefeituraId: string;
  categorias: CategoriaPlano[];
  atualizadoEm: string;
}

export interface SalvarPlanoPreventivoInput {
  categorias: CategoriaPlano[];
}
