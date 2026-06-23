const STATUS_SOL_BLOQUEIA_APROVACAO = new Set([
  'aprovado',
  'concluido',
  'recusado',
]);

const STATUS_ORDEM_APROVAVEL = new Set([
  'aguardando_aprovacao',
  'em_pregao',
]);

const STATUS_ORDEM_RECUSAVEL = new Set([
  'aguardando_aprovacao',
  'em_pregao',
]);

function texto(valor: unknown): string {
  return typeof valor === 'string' ? valor.trim().toLowerCase() : '';
}

export function solicitacaoPermiteAprovacao(status: unknown): boolean {
  return !STATUS_SOL_BLOQUEIA_APROVACAO.has(texto(status));
}

export function ordemElegivelParaAprovacao(status: unknown): boolean {
  return STATUS_ORDEM_APROVAVEL.has(texto(status));
}

export function ordemElegivelParaRecusa(status: unknown): boolean {
  return STATUS_ORDEM_RECUSAVEL.has(texto(status));
}
