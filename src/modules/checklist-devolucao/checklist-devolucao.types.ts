export type ChecklistItemStatus = 'ok' | 'anomaly' | 'na' | '';

export type OldPartDestination =
  | 'Descarte ecológico'
  | 'Devolvida ao cliente'
  | '';

export type ChecklistDevolucaoStatus =
  | 'enviado'
  | 'em_conferencia'
  | 'aceito'
  | 'contestado';

export interface ChecklistDevolucaoIdentification {
  /** Protocolo da O.S. existente (ex.: OS-2026-047) — enviado pelo front, não gerado pelo back. */
  os: string;
  date: string;
  time: string;
  brandModel: string;
  platePrefix: string;
  currentKm: string;
  hourMeter: string;
  driver: string;
  technicalResponsible: string;
  fuel: string;
}

export interface ChecklistDevolucaoStateItem {
  status: ChecklistItemStatus;
  photo?: string;
  description?: string;
}

export interface ChecklistDevolucaoModuleItem {
  status: ChecklistItemStatus;
  photo?: string;
  description?: string;
}

export interface ChecklistDevolucaoPartItem {
  description: string;
  partNumber: string;
  brand: string;
  oldPartDestination: OldPartDestination;
  newPhoto?: string;
  replacedPhoto?: string;
}

export interface ChecklistDevolucaoServiceItem {
  systemComponent: string;
  initialDiagnosis: string;
  technicalAction: string;
  technician: string;
  manHours: string;
}

export interface ChecklistDevolucaoClosing {
  inventoryChecked: boolean;
  driverSignature: string;
  workshopSignature: string;
}

export interface ChecklistDevolucaoConferencia {
  aceito: boolean;
  observacoes: string | null;
  conferidoPor: string | null;
  conferidoEm: string;
}

export interface ChecklistDevolucaoDoc {
  id: string;
  number: string;
  oficinaId: string;
  parceiroId: string | null;
  prefeituraId: string | null;
  solicitacaoOsId: string | null;
  ordemServicoId: string | null;
  identification: ChecklistDevolucaoIdentification;
  generalState: Record<string, ChecklistDevolucaoStateItem>;
  modules: Record<string, ChecklistDevolucaoModuleItem>;
  parts: { items: ChecklistDevolucaoPartItem[] };
  services: { items: ChecklistDevolucaoServiceItem[] };
  closing: ChecklistDevolucaoClosing;
  status: ChecklistDevolucaoStatus;
  prefeituraConferencia?: ChecklistDevolucaoConferencia;
  createdAt: string;
  updatedAt?: string;
}

