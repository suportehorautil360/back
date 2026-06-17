import type { Timestamp } from 'firebase-admin/firestore';

/** Tipo de manutenção da O.S. (body da API em inglês). */
export const OS_SERVICE_TYPES = ['corrective', 'preventive'] as const;
export type OsServiceType = (typeof OS_SERVICE_TYPES)[number];

/** @deprecated Use OS_SERVICE_TYPES — alias legado */
export const OS_TYPE_OPTIONS = ['C', 'P'] as const;
export type OsType = (typeof OS_TYPE_OPTIONS)[number];

export const SOLICITACAO_STATUS_OPTIONS = [
  'aguardando_orcamento',
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
  criadoEm: { seconds: number } | null;
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
