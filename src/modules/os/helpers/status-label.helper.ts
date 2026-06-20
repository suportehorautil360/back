export function solicitacaoStatusLabel(status: string): string {
  if (status === 'aguardando_orcamento') return 'Aguard. Orçamento';
  if (status === 'aguardando_aprovacao') return 'Aguard. Aprovação';
  if (status === 'aprovado') return 'Aprovado';
  if (status === 'concluido') return 'Concluído';
  return status || '—';
}
