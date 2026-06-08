export type TipoParceiro = 'posto' | 'oficina';

/** Posto de combustível credenciado (rede de parceiros). */
export interface PostoParceiro {
  id: string;
  nome: string;
  razaoSocial: string;
  cidadeUf: string;
  bandeira: string;
  condicaoPagamento: string;
  limiteCredito: number;
  ativo: boolean;
}

/** Oficina mecânica credenciada (rede de parceiros). */
export interface OficinaParceiro {
  id: string;
  nome: string;
  razaoSocial: string;
  cidadeUf: string;
  especialidade: string;
  condicaoPagamento: string;
  limiteCredito: number;
  ativo: boolean;
}

export interface ParceirosOverview {
  postos: PostoParceiro[];
  oficinas: OficinaParceiro[];
}
