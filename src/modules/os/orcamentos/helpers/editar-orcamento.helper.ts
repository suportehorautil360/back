const STATUS_SOL_PERMITE_EDICAO = new Set(['em_orcamento', 'pregao']);

const STATUS_ORDEM_PERMITE_EDICAO = new Set([
  'em_pregao',
  'aguardando_aprovacao',
]);

function texto(valor: unknown): string {
  return typeof valor === 'string' ? valor.trim().toLowerCase() : '';
}

export function solicitacaoPermiteEdicaoOrcamento(status: unknown): boolean {
  return STATUS_SOL_PERMITE_EDICAO.has(texto(status));
}

export function ordemPermiteEdicao(status: unknown): boolean {
  const normalized = texto(status);
  if (!normalized) return true;
  return STATUS_ORDEM_PERMITE_EDICAO.has(normalized);
}
