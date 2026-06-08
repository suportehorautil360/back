export type TipoLancamento = 'receita' | 'despesa';
export type StatusLancamento = 'pago' | 'pendente' | 'atrasado';

export interface LancamentoFinanceiro {
  id: string;
  documento: string;
  tipo: TipoLancamento;
  descricao: string;
  /** Magnitude positiva; o sinal é dado pelo `tipo`. */
  valor: number;
  vencimento: string;
  status: StatusLancamento;
}

export interface ResumoFinanceiro {
  receitas: number;
  despesas: number;
  saldo: number;
  total: number;
}

export interface FinanceiroOverview {
  lancamentos: LancamentoFinanceiro[];
  resumo: ResumoFinanceiro;
}
