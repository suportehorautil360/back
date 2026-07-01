export type TipoParceiro = 'posto' | 'oficina';

/** Posto de combustível credenciado (rede de parceiros). */
export interface PostoParceiro {
  id: string;
  prefeituraId: string;
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
  prefeituraId: string;
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

/** Detalhe completo para edição no Hub. */
export interface ParceiroDetalhe {
  id: string;
  tipo: TipoParceiro;
  prefeituraId: string;
  razaoSocial: string;
  nomeFantasia: string;
  cnpj: string;
  telefonePrincipal: string;
  emailComercial: string;
  cidadeUf: string;
  endereco: string;
  bandeira: string;
  combustiveis: string[];
  servicos: string[];
  linhasAtuacao: string[];
  segmentosAtuacao: string[];
  categoriasServico: string[];
  especificacoes: string;
  condicaoPagamento: string;
  limiteCredito: number;
  descontoComercial: string;
  observacoesFaturamento: string;
  status: string;
  ativo: boolean;
}
