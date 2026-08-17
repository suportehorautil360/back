import { timestampToIso } from '../../os/helpers/timestamp.helper';
import type { NotaFiscal } from '../../../prisma/generated/client';
import type { NotaFiscalApiItem, NotaFiscalFirestore } from '../notas-fiscais.types';

function texto(valor: unknown): string {
  return typeof valor === 'string' ? valor.trim() : '';
}

function numero(valor: unknown): number {
  if (typeof valor === 'number') return Number.isFinite(valor) ? valor : 0;
  if (typeof valor === 'string') {
    const parsed = Number(valor.replace(',', '.'));
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

export function mapNotaFiscalToApi(
  id: string,
  raw: Record<string, unknown>,
): NotaFiscalApiItem {
  const createdAt = timestampToIso(raw.criadoEm ?? raw.createdAt);

  return {
    id: texto(raw.id) || id,
    oficinaId: texto(raw.oficinaId),
    ...(texto(raw.postoId) ? { postoId: texto(raw.postoId) } : {}),
    ...(texto(raw.parceiroId) ? { parceiroId: texto(raw.parceiroId) } : {}),
    ...(texto(raw.prefeituraId) ? { prefeituraId: texto(raw.prefeituraId) } : {}),
    ...(texto(raw.solicitacaoOsId)
      ? { solicitacaoOsId: texto(raw.solicitacaoOsId) }
      : {}),
    description: texto(raw.description),
    category: (texto(raw.category) || 'outros') as NotaFiscalApiItem['category'],
    documentType: (texto(raw.documentType) ||
      'nfe-55') as NotaFiscalApiItem['documentType'],
    number: texto(raw.number),
    issuerName: texto(raw.issuerName),
    issuedAt: texto(raw.issuedAt) || createdAt,
    accessKey: texto(raw.accessKey),
    value: numero(raw.value),
    status: (texto(raw.status) || 'pendente') as NotaFiscalApiItem['status'],
    fileName: texto(raw.fileName),
    fileUrl: texto(raw.fileUrl),
    createdAt,
    ...(texto(raw.parseCompleteness) === 'completo' ||
    texto(raw.parseCompleteness) === 'parcial'
      ? {
          parseCompleteness: texto(
            raw.parseCompleteness,
          ) as NotaFiscalApiItem['parseCompleteness'],
        }
      : {}),
  };
}

export function mapNotaFiscalDocToApi(doc: NotaFiscalFirestore): NotaFiscalApiItem {
  return mapNotaFiscalToApi(doc.id, doc as unknown as Record<string, unknown>);
}

export function mapNotaFiscalRowToApi(
  row: NotaFiscal,
  prefeituraId?: string,
): NotaFiscalApiItem {
  return mapNotaFiscalToApi(row.legacyId ?? row.id, {
    id: row.legacyId ?? row.id,
    oficinaId: row.oficinaLegacyId ?? '',
    postoId: row.postoLegacyId ?? '',
    parceiroId: row.parceiroLegacyId ?? '',
    prefeituraId: prefeituraId ?? '',
    solicitacaoOsId: row.solicitacaoOsId ?? '',
    description: row.description ?? '',
    category: row.category,
    documentType: row.documentType,
    number: row.number ?? '',
    issuerName: row.issuerName ?? '',
    issuedAt: row.issuedAt?.toISOString() ?? row.createdAt.toISOString(),
    accessKey: row.accessKey ?? '',
    value: Number(row.value),
    status: row.status,
    fileName: row.fileName ?? '',
    fileUrl: row.fileUrl ?? '',
    createdAt: row.createdAt.toISOString(),
    parseCompleteness: row.parseCompleteness ?? undefined,
  });
}
