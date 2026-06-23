import {
  timestampToIso,
  timestampToSeconds,
} from './timestamp.helper';
import type { OrdemOrcamentoListItem } from '../os.types';

function texto(valor: unknown): string {
  return typeof valor === 'string' ? valor.trim() : '';
}

function numero(valor: unknown): number {
  if (typeof valor === 'number') return Number.isFinite(valor) ? valor : 0;
  if (typeof valor === 'string') {
    const n = Number(valor.replace(',', '.'));
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

function mapItens(raw: unknown): OrdemOrcamentoListItem['items'] {
  if (!Array.isArray(raw)) return [];

  return raw
    .map((item) => {
      if (!item || typeof item !== 'object') return null;
      const rec = item as Record<string, unknown>;
      const descricao = texto(rec.descricao) || texto(rec.description);
      const valor = numero(rec.valor ?? rec.value);
      if (!descricao) return null;
      return {
        description: descricao,
        descricao,
        value: valor,
        valor,
      };
    })
    .filter((item): item is OrdemOrcamentoListItem['items'][number] => item !== null);
}

export function mapOrdemServicoListItem(
  docId: string,
  data: Record<string, unknown>,
): OrdemOrcamentoListItem {
  const protocolo = texto(data.protocolo) || texto(data.protocol);
  const oficinaNome = texto(data.oficinaNome) || texto(data.workshopName);
  const operador = texto(data.operador) || texto(data.operator) || oficinaNome;
  const equipamento = texto(data.equipamento) || texto(data.equipment);
  const defeito = texto(data.defeito) || texto(data.defect);
  const itens = mapItens(data.itens ?? data.items);
  const valorTotal =
    numero(data.valorTotal ?? data.totalValue) ||
    itens.reduce((acc, item) => acc + item.valor, 0);
  const createdAt = timestampToIso(data.criadoEm ?? data.createdAt);

  return {
    id: docId,
    protocol: protocolo,
    protocolo,
    solicitacaoOsId: texto(data.solicitacaoOsId),
    oficinaId: texto(data.oficinaId),
    workshopName: oficinaNome,
    oficinaNome,
    operator: operador,
    operador,
    equipment: equipamento,
    equipamento,
    defect: defeito,
    defeito,
    items: itens,
    itens,
    totalValue: valorTotal,
    valorTotal,
    prazoDias: Math.max(1, Math.round(numero(data.prazoDias) || 7)),
    status: texto(data.status) || 'em_pregao',
    createdAt,
    criadoEm: timestampToSeconds(data.criadoEm ?? data.createdAt),
  };
}
