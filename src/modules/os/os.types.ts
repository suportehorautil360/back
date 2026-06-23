import type { Timestamp } from 'firebase-admin/firestore';

/** Tipo de manutenção da O.S. (body da API em inglês). */
export const OS_SERVICE_TYPES = ['corrective', 'preventive'] as const;
export type OsServiceType = (typeof OS_SERVICE_TYPES)[number];

/** @deprecated Use OS_SERVICE_TYPES — alias legado */
export const OS_TYPE_OPTIONS = ['C', 'P'] as const;
export type OsType = (typeof OS_TYPE_OPTIONS)[number];

export const SOLICITACAO_STATUS_OPTIONS = [
  'aguardando_orcamento',
  'em_orcamento',
  'pregao',
  'aguardando_aprovacao',
  'aprovado',
  'concluido',
] as const;

export type SolicitacaoStatus = (typeof SOLICITACAO_STATUS_OPTIONS)[number];

export interface OficinaAtiva {
  id: string;
  nome: string;
  especialidade: string;
}

export interface LanceOs {
  oficinaId: string;
  valor: number;
  prazoDias: number;
  ordemServicoId?: string;
  atualizadoEm?: string;
}

export interface OrcamentoItemFirestore {
  descricao: string;
  valor: number;
}

export interface SolicitacaoOsFirestore {
  protocolo: string;
  prefeituraId: string;
  equipamentoId?: string;
  equipamento: string;
  linha: string;
  operador: string;
  horimetro?: string;
  relato: string;
  oficinas: string[];
  oficinasIds: string[];
  oficinasResponderam: string[];
  lances?: LanceOs[];
  status: string;
  tipoOs?: string;
  serviceType?: OsServiceType;
  dataAgendamento?: string;
  criadoEm?: Timestamp | { seconds: number } | string;
}

export interface SolicitacaoOsListItem {
  id: string;
  protocol: string;
  equipment: string;
  line: string;
  operator: string;
  report: string;
  workshops: string[];
  workshopIds: string[];
  status: string;
  statusLabel: string;
  serviceType: OsServiceType;
  serviceTypeLabel: string;
  dateLabel: string;
  createdAt: string;
  /** Campos legados PT para compatibilidade com o front atual. */
  protocolo: string;
  equipamento: string;
  linha: string;
  operador: string;
  relato: string;
  oficinas: string[];
  oficinasIds: string[];
  oficinasResponderam: string[];
  lances: LanceOs[];
  valorOrcado: number | null;
  criadoEm: { seconds: number } | null;
}

export interface CreateOrcamentoResult {
  id: string;
  protocol: string;
  valorTotal: number;
  prazoDias: number;
  solicitacaoStatus: string;
}

export interface AprovarSolicitacaoResult {
  solicitacaoId: string;
  approvedOrdemId: string;
  status: string;
}

export interface OrdemOrcamentoListItem {
  id: string;
  protocol: string;
  protocolo: string;
  solicitacaoOsId: string;
  oficinaId: string;
  workshopName: string;
  oficinaNome: string;
  operator: string;
  operador: string;
  equipment: string;
  equipamento: string;
  defect: string;
  defeito: string;
  items: Array<{ description: string; descricao: string; value: number; valor: number }>;
  itens: Array<{ description: string; descricao: string; value: number; valor: number }>;
  totalValue: number;
  valorTotal: number;
  prazoDias: number;
  status: string;
  createdAt: string;
  criadoEm: { seconds: number } | null;
}

export interface SolicitacaoComOrcamentosListItem extends SolicitacaoOsListItem {
  quotes: OrdemOrcamentoListItem[];
  orcamentos: OrdemOrcamentoListItem[];
  quotesReceived: number;
  invitedCount: number;
}

export interface InvitedWorkshop {
  id: string;
  name: string;
}

export interface CreateSolicitacaoResult {
  id: string;
  protocol: string;
  serviceType: OsServiceType;
  serviceTypeLabel: string;
  invitedWorkshops: InvitedWorkshop[];
  status: string;
}
