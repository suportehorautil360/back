function texto(valor: unknown): string {
  return typeof valor === 'string' ? valor.trim() : '';
}

/** OS visível para a oficina: convidada e ainda não respondeu (fase recebidas). */
export function shouldIncludeSolicitacaoForOficina(
  data: Record<string, unknown>,
  oficinaId: string,
  prefeituraIdFilter?: string,
  statusFilter = 'aguardando_orcamento',
): boolean {
  const responderam = Array.isArray(data.oficinasResponderam)
    ? data.oficinasResponderam.filter((v): v is string => typeof v === 'string')
    : [];

  const filtroStatus = (statusFilter || 'aguardando_orcamento').toLowerCase();
  if (
    filtroStatus === 'aguardando_orcamento' ||
    filtroStatus === 'recebida' ||
    filtroStatus === 'nova'
  ) {
    if (responderam.includes(oficinaId)) return false;
  }

  const filtroPref = texto(prefeituraIdFilter);
  if (filtroPref && texto(data.prefeituraId) !== filtroPref) return false;

  return true;
}
