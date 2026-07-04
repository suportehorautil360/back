import type { OrdemOrcamentoListItem } from '../../os.types';

export interface OrcamentoApiItem {
  id: string;
  protocol: string;
  solicitacaoOsId: string;
  oficinaId: string;
  valorTotal: number;
  prazoDias: number;
  items: Array<{
    description: string;
    value: number;
    category?: string;
    code?: string;
    brand?: string;
    quantity?: number;
    unitValue?: number;
    hourType?: string;
    hours?: number;
    hourlyRate?: number;
    km?: number;
    valuePerKm?: number;
    travelHours?: number;
    travelHourlyRate?: number;
    fees?: number;
  }>;
  equipamento?: string;
  operador?: string;
  solicitacaoStatus?: string;
  fotosComprovacao?: string[];
  createdAt?: string;
}

function mapOrcamentoItem(
  item: OrdemOrcamentoListItem['items'][number],
): OrcamentoApiItem['items'][number] {
  const mapped: OrcamentoApiItem['items'][number] = {
    description: item.description || item.descricao,
    value: item.value ?? item.valor,
  };

  const source = item as Record<string, unknown>;
  const optionalKeys = [
    'category',
    'code',
    'brand',
    'quantity',
    'unitValue',
    'hourType',
    'hours',
    'hourlyRate',
    'km',
    'valuePerKm',
    'travelHours',
    'travelHourlyRate',
    'fees',
  ] as const;

  for (const key of optionalKeys) {
    const value = source[key];
    if (value !== undefined && value !== null && value !== '') {
      (mapped as Record<string, unknown>)[key] = value;
    }
  }

  return mapped;
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
    items: ordem.items.map(mapOrcamentoItem),
    equipamento: ordem.equipamento || undefined,
    operador: ordem.operador || undefined,
    solicitacaoStatus,
    fotosComprovacao:
      ordem.fotosComprovacao.length > 0 ? ordem.fotosComprovacao : undefined,
    createdAt: ordem.createdAt || undefined,
  };
}
