export const CREDIT_TYPE_OPTIONS = ['equipment', 'workFront'] as const;

export type CreditType = (typeof CREDIT_TYPE_OPTIONS)[number];

export const RESPONSIBLE_OPTIONS = [
  'Financeiro',
  'Operacional',
  'Gestão',
  'Diretoria',
] as const;

export interface CreditoDoc {
  id: string;
  prefeituraId: string;
  type: CreditType;
  equipmentId: string | null;
  plateOrChassis: string | null;
  workFrontId: string | null;
  targetLabel: string;
  amount: number;
  responsible: string;
  observation?: string;
  createdAt: string;
}

export interface CreditoListItem {
  id: string;
  type: CreditType;
  typeLabel: string;
  targetLabel: string;
  amount: number;
  amountLabel: string;
  responsible: string;
  observation: string | null;
  createdAt: string;
  dateLabel: string;
}

export interface CreditoOpcaoItem {
  id: string;
  label: string;
  keywords?: string[];
}

export interface CreditoFormOpcoes {
  typeOptions: Array<{ value: CreditType; label: string }>;
  equipment: CreditoOpcaoItem[];
  workFronts: CreditoOpcaoItem[];
  responsibleOptions: string[];
  suggestedAmounts: number[];
}

export interface CreditoSaldoEquipamento {
  id: string;
  placa: string;
  nome: string;
  local: string;
  saldo: number;
  saldoLabel: string;
  creditado: number;
  creditadoLabel: string;
  gasto: number;
  gastoLabel: string;
}

export interface CreditoSaldoFrente {
  id: string;
  nome: string;
  saldo: number;
  saldoLabel: string;
  creditado: number;
  creditadoLabel: string;
  gasto: number;
  gastoLabel: string;
}

export interface CreditoSaldosPayload {
  saldosEquipamento: CreditoSaldoEquipamento[];
  saldosFrente: CreditoSaldoFrente[];
}
