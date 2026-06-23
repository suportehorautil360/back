import { randomUUID } from 'node:crypto';
import type { ChecklistDevolucaoDoc } from '../../checklist-devolucao/checklist-devolucao.types';
import type { GarantiaDoc } from '../garantias.types';
import {
  GARANTIA_HORIMETRO_DELTA_PADRAO,
  GARANTIA_PRAZO_MESES_PADRAO,
  adicionarMeses,
  calcularStatusGarantia,
} from './calcular-status-garantia.helper';
import { parseHorimetro } from './parse-horimetro.helper';

export interface ContextoGarantiaChd {
  prefeituraId: string;
  equipamentoId: string;
  equipamento: string;
  fornecedor: string;
  horimetroAtual?: number | null;
}

function montarGarantiaBase(
  chd: ChecklistDevolucaoDoc,
  ctx: ContextoGarantiaChd,
  createdAt: string,
): Pick<
  GarantiaDoc,
  | 'prefeituraId'
  | 'equipamentoId'
  | 'equipamento'
  | 'osOrigem'
  | 'solicitacaoOsId'
  | 'ordemServicoId'
  | 'checklistDevolucaoId'
  | 'fornecedor'
  | 'oficinaId'
  | 'dataExecucao'
  | 'horimetroBase'
  | 'prazoMeses'
  | 'limiteHorimetro'
  | 'venceEm'
  | 'createdAt'
> {
  const dataExecucao = chd.identification.date;
  const horimetroBase =
    parseHorimetro(chd.identification.hourMeter) ?? 0;
  const prazoMeses = GARANTIA_PRAZO_MESES_PADRAO;
  const limiteHorimetro =
    horimetroBase + GARANTIA_HORIMETRO_DELTA_PADRAO;
  const venceEm = adicionarMeses(dataExecucao, prazoMeses);

  return {
    prefeituraId: ctx.prefeituraId,
    equipamentoId: ctx.equipamentoId,
    equipamento: ctx.equipamento,
    osOrigem: chd.identification.os,
    solicitacaoOsId: chd.solicitacaoOsId,
    ordemServicoId: chd.ordemServicoId,
    checklistDevolucaoId: chd.id,
    fornecedor: ctx.fornecedor,
    oficinaId: chd.oficinaId,
    dataExecucao,
    horimetroBase,
    prazoMeses,
    limiteHorimetro,
    venceEm,
    createdAt,
  };
}

export function gerarGarantiasDeChecklistDevolucao(
  chd: ChecklistDevolucaoDoc,
  ctx: ContextoGarantiaChd,
  createdAt = new Date().toISOString(),
): GarantiaDoc[] {
  const base = montarGarantiaBase(chd, ctx, createdAt);
  const out: GarantiaDoc[] = [];

  for (const part of chd.parts.items) {
    const item = part.description.trim();
    if (!item) continue;

    const doc: GarantiaDoc = {
      id: randomUUID(),
      ...base,
      tipo: 'peca',
      item,
      partNumber: part.partNumber.trim() || null,
      status: calcularStatusGarantia({
        venceEmIso: base.venceEm,
        limiteHorimetro: base.limiteHorimetro,
        horimetroAtual: ctx.horimetroAtual,
      }),
    };
    out.push(doc);
  }

  for (const svc of chd.services.items) {
    const item = svc.systemComponent.trim();
    if (!item) continue;

    const doc: GarantiaDoc = {
      id: randomUUID(),
      ...base,
      tipo: 'servico',
      item,
      partNumber: null,
      status: calcularStatusGarantia({
        venceEmIso: base.venceEm,
        limiteHorimetro: base.limiteHorimetro,
        horimetroAtual: ctx.horimetroAtual,
      }),
    };
    out.push(doc);
  }

  return out;
}
