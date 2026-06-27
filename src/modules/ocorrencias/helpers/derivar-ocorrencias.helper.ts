import type { ChecklistDevolucaoDoc } from '../../checklist-devolucao/checklist-devolucao.types';
import {
  formatDateTimeBrFromIso,
  timestampToIso,
} from '../../os/helpers/timestamp.helper';
import type { OcorrenciaDoc } from '../ocorrencias.types';

function texto(valor: unknown): string {
  return typeof valor === 'string' ? valor.trim() : '';
}

function numero(valor: unknown): number {
  if (typeof valor === 'number' && Number.isFinite(valor)) return valor;
  if (typeof valor === 'string' && valor.trim()) {
    const n = Number(valor.replace(',', '.'));
    if (Number.isFinite(n)) return n;
  }
  return 0;
}

function fmtBRL(valor: number): string {
  return valor.toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  });
}

function pushEvento(
  linhas: OcorrenciaDoc[],
  partial: Omit<OcorrenciaDoc, 'dataHora'> & { dataHoraIso: string },
): void {
  const iso = partial.dataHoraIso.trim();
  if (!iso) return;

  linhas.push({
    ...partial,
    dataHora: formatDateTimeBrFromIso(iso),
  });
}

function derivarDeSolicitacao(
  solId: string,
  sol: Record<string, unknown>,
): OcorrenciaDoc[] {
  const linhas: OcorrenciaDoc[] = [];
  const protocolo = texto(sol.protocolo) || texto(sol.protocol) || solId;
  const equipamento = texto(sol.equipamento) || texto(sol.equipment);
  const operador = texto(sol.operador) || texto(sol.operator) || 'Prefeitura';

  const criadoEm = timestampToIso(sol.criadoEm ?? sol.createdAt);
  if (criadoEm) {
    pushEvento(linhas, {
      id: `${solId}-abertura`,
      dataHoraIso: criadoEm,
      usuario: operador,
      mensagem: equipamento
        ? `O.S. ${protocolo} aberta para ${equipamento}.`
        : `O.S. ${protocolo} aberta.`,
      tipo: 'os_aberta',
    });
  }

  const aprovadoEm = texto(sol.aprovadoEm);
  if (aprovadoEm) {
    pushEvento(linhas, {
      id: `${solId}-aprovacao`,
      dataHoraIso: aprovadoEm,
      usuario: 'Prefeitura',
      mensagem: `Orçamento aprovado — O.S. ${protocolo} liberada para execução.`,
      tipo: 'os_aprovada',
    });
  }

  const status = texto(sol.status);
  if (status === 'concluido') {
    const concluidoEm =
      texto(sol.concluidoEm) ||
      texto(sol.updatedAt) ||
      aprovadoEm ||
      criadoEm;
    if (concluidoEm) {
      pushEvento(linhas, {
        id: `${solId}-conclusao`,
        dataHoraIso: concluidoEm,
        usuario: 'Prefeitura',
        mensagem: `O.S. ${protocolo} concluída.`,
        tipo: 'os_concluida',
      });
    }
  }

  return linhas;
}

function derivarDeOrdens(
  ordens: Array<{ id: string; data: Record<string, unknown> }>,
): OcorrenciaDoc[] {
  const linhas: OcorrenciaDoc[] = [];

  for (const { id, data } of ordens) {
    const oficina =
      texto(data.oficinaNome) ||
      texto(data.workshopName) ||
      texto(data.operador) ||
      texto(data.operator) ||
      'Oficina';
    const valorTotal = numero(data.valorTotal ?? data.totalValue);
    const valorLabel = valorTotal > 0 ? fmtBRL(valorTotal) : '';

    const criadoEm = timestampToIso(data.criadoEm ?? data.createdAt);
    if (criadoEm) {
      pushEvento(linhas, {
        id: `${id}-orc-enviado`,
        dataHoraIso: criadoEm,
        usuario: oficina,
        mensagem: valorLabel
          ? `Orçamento enviado por ${oficina} — ${valorLabel}.`
          : `Orçamento enviado por ${oficina}.`,
        tipo: 'orcamento_enviado',
      });
    }

    const atualizadoEm = texto(data.atualizadoEm ?? data.updatedAt);
    if (atualizadoEm && atualizadoEm !== criadoEm) {
      pushEvento(linhas, {
        id: `${id}-orc-atualizado`,
        dataHoraIso: atualizadoEm,
        usuario: oficina,
        mensagem: valorLabel
          ? `Orçamento de ${oficina} atualizado — ${valorLabel}.`
          : `Orçamento de ${oficina} atualizado.`,
        tipo: 'orcamento_atualizado',
      });
    }

    const aprovadoEm = texto(data.aprovadoEm);
    if (aprovadoEm) {
      pushEvento(linhas, {
        id: `${id}-orc-aprovado`,
        dataHoraIso: aprovadoEm,
        usuario: 'Prefeitura',
        mensagem: `Orçamento de ${oficina} aprovado.`,
        tipo: 'orcamento_aprovado',
      });
    }

    const recusadoEm = texto(data.recusadoEm);
    if (recusadoEm) {
      pushEvento(linhas, {
        id: `${id}-orc-recusado`,
        dataHoraIso: recusadoEm,
        usuario: 'Prefeitura',
        mensagem: `Orçamento de ${oficina} recusado.`,
        tipo: 'orcamento_recusado',
      });
    }
  }

  return linhas;
}

function derivarDeChds(chds: ChecklistDevolucaoDoc[]): OcorrenciaDoc[] {
  const linhas: OcorrenciaDoc[] = [];

  for (const chd of chds) {
    const numeroChd = chd.number || chd.id;
    const oficina = chd.identification?.technicalResponsible?.trim() || 'Oficina';

    if (chd.createdAt) {
      pushEvento(linhas, {
        id: `${chd.id}-chd-registrado`,
        dataHoraIso: chd.createdAt,
        usuario: oficina,
        mensagem: `Checklist de devolução ${numeroChd} registrado.`,
        tipo: 'chd_registrado',
      });
    }

    const conf = chd.prefeituraConferencia;
    if (conf?.conferidoEm) {
      const obs = conf.observacoes?.trim();
      pushEvento(linhas, {
        id: `${chd.id}-chd-conferido`,
        dataHoraIso: conf.conferidoEm,
        usuario: conf.conferidoPor?.trim() || 'Prefeitura',
        mensagem: conf.aceito
          ? obs
            ? `CHD ${numeroChd} aceito pela prefeitura. Obs.: ${obs}`
            : `CHD ${numeroChd} aceito pela prefeitura.`
          : obs
            ? `CHD ${numeroChd} contestado pela prefeitura. Obs.: ${obs}`
            : `CHD ${numeroChd} contestado pela prefeitura.`,
        tipo: conf.aceito ? 'chd_aceito' : 'chd_contestado',
      });
    } else if (chd.status === 'aceito' && chd.updatedAt) {
      pushEvento(linhas, {
        id: `${chd.id}-chd-aceito`,
        dataHoraIso: chd.updatedAt,
        usuario: 'Prefeitura',
        mensagem: `CHD ${numeroChd} aceito pela prefeitura.`,
        tipo: 'chd_aceito',
      });
    } else if (chd.status === 'contestado' && chd.updatedAt) {
      pushEvento(linhas, {
        id: `${chd.id}-chd-contestado`,
        dataHoraIso: chd.updatedAt,
        usuario: 'Prefeitura',
        mensagem: `CHD ${numeroChd} contestado pela prefeitura.`,
        tipo: 'chd_contestado',
      });
    }
  }

  return linhas;
}

export function derivarOcorrenciasOs(input: {
  solicitacaoId: string;
  solicitacao: Record<string, unknown>;
  ordens: Array<{ id: string; data: Record<string, unknown> }>;
  chds: ChecklistDevolucaoDoc[];
}): OcorrenciaDoc[] {
  const linhas = [
    ...derivarDeSolicitacao(input.solicitacaoId, input.solicitacao),
    ...derivarDeOrdens(input.ordens),
    ...derivarDeChds(input.chds),
  ];

  return linhas.sort((a, b) => b.dataHoraIso.localeCompare(a.dataHoraIso));
}
