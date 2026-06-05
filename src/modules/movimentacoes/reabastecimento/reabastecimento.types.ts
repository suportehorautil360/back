import { MovimentacaoBaseDoc } from '../movimentacoes.types';

export interface ReabastecimentoMovimentacaoDoc extends MovimentacaoBaseDoc {
  tipo: 'reabastecimento';
  sourceType: 'gasStation' | 'farmTank' | 'distributor';
  receivedLiters: number;
  invoiceNumber?: string;
  clientRequestId?: string;
}
