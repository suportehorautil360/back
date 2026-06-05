export type MovimentacaoTipo =
  | 'abastecimento'
  | 'lubrificacao'
  | 'reabastecimento';

export interface MovimentacaoBaseDoc {
  id: string;
  prefeituraId: string;
  equipmentId: string;
  tipo: MovimentacaoTipo;
  createdAt: string;
  latitude?: number;
  longitude?: number;
}
