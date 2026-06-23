import type { OrdemOrcamentoListItem } from '../../os.types';

export interface OrcamentoApiItem {
  id: string;
  protocol: string;
  solicitacaoOsId: string;
  oficinaId: string;
  valorTotal: number;
  prazoDias: number;
  items: Array<{ description: string; value: number }>;
  equipamento?: string;
  operador?: string;
  solicitacaoStatus?: string;
  createdAt?: string;
}

export function mapOrdemToOrcamentoApi(
  ordem: OrdemOrcamentoListItem,
  solicitacaoStatus?: string,
): OrcamentoApiItem {
  return {
    id: ordem.id,
    protocol: ordem.protocolo || ordem.protocol,
    solicitacaoOsId: ordem.solicitacaoOsId,
    oficinaId: ordem.oficinaId,
    valorTotal: ordem.valorTotal,
    prazoDias: ordem.prazoDias,
    items: ordem.items.map((item) => ({
      description: item.description || item.descricao,
      value: item.value ?? item.valor,
    })),
    equipamento: ordem.equipamento || undefined,
    operador: ordem.operador || undefined,
    solicitacaoStatus,
    createdAt: ordem.createdAt || undefined,
  };
}
