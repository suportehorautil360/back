import type {
  StatusLancamento,
  TipoLancamento,
} from '../../prisma/generated/client';
import type {
  LancamentoFinanceiro,
  StatusLancamento as StatusApi,
  TipoLancamento as TipoApi,
} from '../../modules/financeiro/financeiro.types';

type LancamentoRow = {
  id: string;
  numero: number;
  tipo: TipoLancamento;
  descricao: string;
  valor: unknown;
  vencimento: Date | null;
  status: StatusLancamento;
};

export function mapTipoToApi(tipo: TipoLancamento): TipoApi {
  return tipo === 'DESPESA' ? 'despesa' : 'receita';
}

export function mapTipoFromApi(tipo: TipoApi): TipoLancamento {
  return tipo === 'despesa' ? 'DESPESA' : 'RECEITA';
}

export function mapStatusToApi(status: StatusLancamento): StatusApi {
  switch (status) {
    case 'PAGO':
      return 'pago';
    case 'ATRASADO':
      return 'atrasado';
    default:
      return 'pendente';
  }
}

export function mapStatusFromApi(status: StatusApi): StatusLancamento {
  switch (status) {
    case 'pago':
      return 'PAGO';
    case 'atrasado':
      return 'ATRASADO';
    default:
      return 'PENDENTE';
  }
}

export function formatDocumento(numero: number): string {
  return `FI-${numero}`;
}

export function mapLancamentoFromRow(row: LancamentoRow): LancamentoFinanceiro {
  return {
    id: row.id,
    documento: formatDocumento(row.numero),
    tipo: mapTipoToApi(row.tipo),
    descricao: row.descricao,
    valor: Number(row.valor),
    vencimento: row.vencimento
      ? row.vencimento.toISOString().slice(0, 10)
      : '',
    status: mapStatusToApi(row.status),
  };
}

export function parseVencimento(value: string): Date | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    const [yyyy, mm, dd] = trimmed.split('-').map(Number);
    return new Date(Date.UTC(yyyy, mm - 1, dd));
  }
  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function numeroDocumento(documento: string): number {
  const m = /(\d+)/.exec(documento);
  return m ? Number(m[1]) : 0;
}
