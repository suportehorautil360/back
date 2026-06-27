import type { NotaFiscalPrefeituraListItem } from './notas-fiscais-prefeitura.helper';

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

const MESES_CURTOS = [
  'jan',
  'fev',
  'mar',
  'abr',
  'mai',
  'jun',
  'jul',
  'ago',
  'set',
  'out',
  'nov',
  'dez',
];

export interface NotaFiscalResumoGrafico {
  label: string;
  valor: number;
  quantidade?: number;
}

export interface NotasFiscaisResumo {
  totalNotas: number;
  valorTotal: number;
  pendentes: number;
  aprovadas: number;
  rejeitadas: number;
  oficinas: number;
  porMes: NotaFiscalResumoGrafico[];
  porStatus: NotaFiscalResumoGrafico[];
  porOficina: NotaFiscalResumoGrafico[];
}

/** Valor confiável para KPI — ignora leitura parcial sem valor extraído. */
export function valorContabilNotaFiscal(item: NotaFiscalPrefeituraListItem): number {
  if (item.parseCompleteness === 'completo') {
    return numero(item.value);
  }

  const chave = item.accessKey.replace(/\D/g, '');
  if (chave.length === 44) return numero(item.value);

  if (
    numero(item.value) > 0 &&
    texto(item.issuerName) !== 'Aguardando leitura do PDF'
  ) {
    return numero(item.value);
  }

  return 0;
}

function labelMes(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 7);
  return `${MESES_CURTOS[d.getMonth()]}/${d.getFullYear()}`;
}

function chaveMes(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 7);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

export function calcularResumoNotasFiscais(
  itens: NotaFiscalPrefeituraListItem[],
): NotasFiscaisResumo {
  let valorTotal = 0;
  let pendentes = 0;
  let aprovadas = 0;
  let rejeitadas = 0;
  const oficinasSet = new Set<string>();
  const mesMap = new Map<string, NotaFiscalResumoGrafico>();
  const oficinaMap = new Map<string, NotaFiscalResumoGrafico>();

  for (const item of itens) {
    if (item.oficinaId) oficinasSet.add(item.oficinaId);

    const valor = valorContabilNotaFiscal(item);
    valorTotal += valor;

    if (item.status === 'aprovada') aprovadas += 1;
    else if (item.status === 'rejeitada') rejeitadas += 1;
    else pendentes += 1;

    const mesKey = chaveMes(item.createdAt);
    const mesAtual = mesMap.get(mesKey) ?? {
      label: labelMes(item.createdAt),
      valor: 0,
      quantidade: 0,
    };
    mesAtual.valor += valor;
    mesAtual.quantidade = (mesAtual.quantidade ?? 0) + 1;
    mesMap.set(mesKey, mesAtual);

    const oficinaLabel = item.oficinaNome || item.oficinaId || 'Oficina';
    const oficinaAtual = oficinaMap.get(item.oficinaId) ?? {
      label: oficinaLabel,
      valor: 0,
      quantidade: 0,
    };
    oficinaAtual.valor += valor;
    oficinaAtual.quantidade = (oficinaAtual.quantidade ?? 0) + 1;
    oficinaMap.set(item.oficinaId, oficinaAtual);
  }

  const porMes = [...mesMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, v]) => v)
    .slice(-6);

  const porStatus: NotaFiscalResumoGrafico[] = [
    { label: 'Pendente', valor: pendentes },
    { label: 'Aprovada', valor: aprovadas },
    { label: 'Rejeitada', valor: rejeitadas },
  ].filter((s) => s.valor > 0);

  const porOficina = [...oficinaMap.values()]
    .sort((a, b) => b.valor - a.valor || (b.quantidade ?? 0) - (a.quantidade ?? 0))
    .slice(0, 5)
    .map((o) => ({
      label: o.label.length > 22 ? `${o.label.slice(0, 20)}…` : o.label,
      valor: o.valor,
      quantidade: o.quantidade,
    }));

  return {
    totalNotas: itens.length,
    valorTotal,
    pendentes,
    aprovadas,
    rejeitadas,
    oficinas: oficinasSet.size,
    porMes,
    porStatus,
    porOficina,
  };
}
