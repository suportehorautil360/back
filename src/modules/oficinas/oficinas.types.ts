export interface OficinaListItem {
  id: string;
  nome: string;
  razaoSocial: string;
  nomeFantasia: string;
  cnpj: string;
  cidadeUf: string;
  endereco: string;
  telefonePrincipal: string;
  emailComercial: string;
  especialidade: string;
  linhasAtuacao: string[];
  categoriasServico: string[];
  status: string;
  ativo: boolean;
  prefeituraId: string | null;
  parceiroId: string | null;
  credenciadoEm: string | null;
  createdAt: string | null;
}
