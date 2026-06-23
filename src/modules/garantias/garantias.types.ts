export type GarantiaTipo = 'peca' | 'servico';

export type GarantiaStatus = 'vigente' | 'vencendo' | 'vencido';

export interface GarantiaDoc {
  id: string;
  prefeituraId: string;
  equipamentoId: string;
  equipamento: string;
  osOrigem: string;
  solicitacaoOsId: string | null;
  ordemServicoId: string | null;
  checklistDevolucaoId: string;
  tipo: GarantiaTipo;
  item: string;
  partNumber: string | null;
  fornecedor: string;
  oficinaId: string;
  dataExecucao: string;
  horimetroBase: number;
  prazoMeses: number;
  limiteHorimetro: number;
  venceEm: string;
  status: GarantiaStatus;
  createdAt: string;
}

export interface GarantiaListItem {
  id: string;
  osOrigem: string;
  dataExec: string;
  tipo: GarantiaTipo;
  tipoLabel: string;
  item: string;
  fornecedor: string;
  prazo: string;
  limiteHorimetro: string;
  venceEm: string;
  status: GarantiaStatus;
  horimetroBase: number;
  prazoMeses: number;
  limiteHorimetroNum: number;
  venceEmIso: string;
}

export interface GarantiaResumoEquipamento {
  equipamentoId: string;
  equipamento: string;
  horimetroAtual: number | null;
  itensEmGarantia: number;
  prestesAVencer: number;
}
