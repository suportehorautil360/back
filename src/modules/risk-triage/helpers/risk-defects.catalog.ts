export const DEFEITO_CATALOGO_POR_QUESTION_ID = {
  buzina: 'Falha na buzina de seguranca',
  luzes_de_trabalho: 'Falha na iluminacao de trabalho',
  alarme_de_re: 'Falha no alarme de re',
  freio: 'Falha no sistema de freio',
  nivel_de_oleo: 'Nivel de oleo fora do padrao',
  filtro_de_ar: 'Falha no filtro de ar',
  separador_dagua: 'Falha no separador de agua',
  extintor: 'Extintor ausente, vencido ou irregular',
  pneus: 'Pneus em condicao irregular',
  sistema_hidraulico: 'Falha no sistema hidraulico',
} as const;

export type DefectCatalogKey = keyof typeof DEFEITO_CATALOGO_POR_QUESTION_ID;
