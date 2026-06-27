import type { GarantiaDoc, GarantiaListItem } from '../garantias.types';
import {
  calcularStatusGarantia,
  formatDataBr,
} from './calcular-status-garantia.helper';
import { formatHorimetro } from './parse-horimetro.helper';

function texto(valor: unknown): string {
  return typeof valor === 'string' ? valor.trim() : '';
}

function tipoLabel(tipo: GarantiaDoc['tipo']): string {
  return tipo === 'peca' ? 'Peça' : 'Serviço';
}

export function mapGarantiaFromFirestore(
  docId: string,
  data: Record<string, unknown>,
): GarantiaDoc {
  const tipoRaw = texto(data.tipo).toLowerCase();
  const tipo = tipoRaw === 'servico' ? 'servico' : 'peca';
  const statusRaw = texto(data.status).toLowerCase();
  const status =
    statusRaw === 'vencendo' || statusRaw === 'vencido'
      ? statusRaw
      : 'vigente';

  return {
    id: docId,
    prefeituraId: texto(data.prefeituraId),
    equipamentoId: texto(data.equipamentoId),
    equipamento: texto(data.equipamento),
    osOrigem: texto(data.osOrigem),
    solicitacaoOsId: texto(data.solicitacaoOsId) || null,
    ordemServicoId: texto(data.ordemServicoId) || null,
    checklistDevolucaoId: texto(data.checklistDevolucaoId),
    tipo,
    item: texto(data.item),
    partNumber: texto(data.partNumber) || null,
    fornecedor: texto(data.fornecedor),
    oficinaId: texto(data.oficinaId),
    dataExecucao: texto(data.dataExecucao),
    horimetroBase: Number(data.horimetroBase) || 0,
    prazoMeses: Number(data.prazoMeses) || 3,
    limiteHorimetro: Number(data.limiteHorimetro) || 0,
    venceEm: texto(data.venceEm),
    status,
    createdAt: texto(data.createdAt),
  };
}

export function mapGarantiaParaLista(
  doc: GarantiaDoc,
  horimetroAtual?: number | null,
): GarantiaListItem {
  const status = calcularStatusGarantia({
    venceEmIso: doc.venceEm,
    limiteHorimetro: doc.limiteHorimetro,
    horimetroAtual,
  });

  return {
    id: doc.id,
    osOrigem: doc.osOrigem,
    checklistDevolucaoId: doc.checklistDevolucaoId || undefined,
    dataExec: formatDataBr(doc.dataExecucao),
    tipo: doc.tipo,
    tipoLabel: tipoLabel(doc.tipo),
    item: doc.item,
    fornecedor: doc.fornecedor,
    prazo: `${doc.prazoMeses} meses`,
    limiteHorimetro: formatHorimetro(doc.limiteHorimetro),
    venceEm: formatDataBr(doc.venceEm),
    status,
    horimetroBase: doc.horimetroBase,
    prazoMeses: doc.prazoMeses,
    limiteHorimetroNum: doc.limiteHorimetro,
    venceEmIso: doc.venceEm,
  };
}
