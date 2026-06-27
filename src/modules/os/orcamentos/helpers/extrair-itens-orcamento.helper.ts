function texto(valor: unknown): string {
  if (typeof valor === 'string') return valor.trim();
  if (typeof valor === 'number' && Number.isFinite(valor)) return String(valor);
  return '';
}

/** Extrai linhas de peças/itens de um documento `ordensServico`. */
export function extrairItensOrcamentoDoc(
  data: Record<string, unknown>,
): Record<string, unknown>[] {
  const chaves = ['pecas', 'parts', 'itens', 'items', 'materiais'] as const;
  const vistos = new Set<Record<string, unknown>>();
  const linhas: Record<string, unknown>[] = [];

  for (const chave of chaves) {
    const raw = data[chave];
    if (!Array.isArray(raw)) continue;

    for (const item of raw) {
      if (!item || typeof item !== 'object') continue;
      const rec = item as Record<string, unknown>;
      if (vistos.has(rec)) continue;
      vistos.add(rec);
      linhas.push(rec);
    }
  }

  return linhas;
}

export function selecionarOrdensParaInsumos(
  ordens: FirebaseFirestore.QueryDocumentSnapshot[],
  solicitacao: Record<string, unknown>,
): FirebaseFirestore.QueryDocumentSnapshot[] {
  const aprovadaId = texto(solicitacao.ordemServicoAprovadaId);
  if (aprovadaId) {
    const aprovada = ordens.filter((doc) => doc.id === aprovadaId);
    if (aprovada.length) return aprovada;
  }

  const aprovadas = ordens.filter((doc) => {
    const status = texto((doc.data() as Record<string, unknown>).status);
    return status === 'aprovado';
  });
  if (aprovadas.length) return aprovadas;

  return ordens;
}
