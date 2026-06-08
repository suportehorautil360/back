export type TipoClienteApi = 'prefeitura' | 'locacao';

export type PerfilAcesso = 'gestor' | 'admin';

/** Linha da visão geral de clientes, com métricas agregadas por cliente. */
export interface ClienteOverviewRow {
  id: string;
  nome: string;
  uf: string;
  tipoCliente: TipoClienteApi;
  /** E-mail da empresa/órgão (origem do domínio dos acessos). */
  email: string;
  /** Equipamentos com status "ativo". */
  ativos: number;
  /** Total de checklists do cliente. */
  checklists: number;
  /** Equipamentos com status "manutencao". */
  emManutencao: number;
  /** Custo acumulado. Zerado até a fonte ser definida. */
  custoAcumulado: number;
  /** O.S. em cotação. Zerado até a fonte ser definida. */
  osCotacao: number;
  /** O.S. em NF / pagamento. Zerado até a fonte ser definida. */
  osNfPagamento: number;
}

/** Acesso (usuário) vinculado a um cliente — coleção `users`. */
export interface AcessoRow {
  id: string;
  nome: string;
  usuario: string;
  email: string;
  whatsapp: string;
  perfil: string;
  notificaEmail: boolean;
  notificaWhatsapp: boolean;
}
