export interface InsumoDoc {
  id: string;
  /** Código da peça no orçamento (opcional). */
  codigo: string;
  /** Nome/descrição da peça. */
  descricao: string;
  marca: string | null;
  qtd: number;
  unid: string;
  vlrUnit: number;
  total: number;
  ordemServicoId: string;
}

export interface InsumoListItem {
  id: string;
  codigo: string;
  /** Alias EN (campo `code` do orçamento). */
  code: string;
  descricao: string;
  marca: string | null;
  qtd: number;
  unid: string;
  vlrUnit: number;
  total: number;
}

export interface InsumoResumoOs {
  totalItens: number;
  valorTotal: number;
  orcamentosEncontrados: number;
}

export function mapInsumoParaLista(doc: InsumoDoc): InsumoListItem {
  return {
    id: doc.id,
    codigo: doc.codigo,
    code: doc.codigo,
    descricao: doc.descricao,
    marca: doc.marca,
    qtd: doc.qtd,
    unid: doc.unid,
    vlrUnit: doc.vlrUnit,
    total: doc.total,
  };
}

export function montarResumoInsumos(
  linhas: InsumoDoc[],
  orcamentosEncontrados: number,
): InsumoResumoOs {
  return {
    totalItens: linhas.length,
    valorTotal: linhas.reduce((acc, i) => acc + i.total, 0),
    orcamentosEncontrados,
  };
}
