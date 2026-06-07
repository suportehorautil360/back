export const TIPO_PARCEIRO_OPTIONS = ['posto', 'oficina'] as const;

export type TipoParceiro = (typeof TIPO_PARCEIRO_OPTIONS)[number];

export interface PostoDoc {
  id: string;
  prefeituraId: string;
  tipoParceiro: TipoParceiro;
  cnpj: string;
  telefonePrincipal: string;
  razaoSocial: string;
  nomeFantasia: string;
  emailComercial: string;
  cidadeUf: string;
  endereco: string;
  precoPorLitro?: number;
  createdAt: string;
}

export interface PostoListItem {
  id: string;
  code: string;
  name: string;
  endereco: string;
  precoPorLitro: number | null;
  precoPorLitroLabel: string;
  abastecimentos: number;
  totalLitros: number;
  totalLitrosLabel: string;
  totalGasto: number;
  totalGastoLabel: string;
  razaoSocial: string;
  cnpj: string;
  telefonePrincipal: string;
  emailComercial: string;
  cidadeUf: string;
  tipoParceiro: TipoParceiro;
  createdAt: string;
}
