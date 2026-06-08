/** Posto de combustível credenciado (rede de parceiros). */
export interface PostoParceiro {
  id: string;
  nome: string;
  cidadeUf: string;
  bandeira: string;
  ativo: boolean;
}

/** Oficina mecânica credenciada (rede de parceiros). */
export interface OficinaParceiro {
  id: string;
  nome: string;
  cidadeUf: string;
  especialidade: string;
  ativo: boolean;
}

export interface ParceirosOverview {
  postos: PostoParceiro[];
  oficinas: OficinaParceiro[];
}
