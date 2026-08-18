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

/** Extrai itens do campo JSON `itens` de um orçamento Postgres. */
export function extrairItensOrcamentoPrisma(
  itens: unknown,
): Record<string, unknown>[] {
  if (Array.isArray(itens)) {
    return itens.filter(
      (item): item is Record<string, unknown> =>
        !!item && typeof item === 'object' && !Array.isArray(item),
    );
  }
  if (itens && typeof itens === 'object') {
    return extrairItensOrcamentoDoc(itens as Record<string, unknown>);
  }
  return [];
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

type OrcamentoInsumoRow = {
  id: string;
  legacyId: string | null;
  status: string;
  itens: unknown;
};

export function selecionarOrdensParaInsumosPg(
  ordens: OrcamentoInsumoRow[],
  solicitacao: { ordemServicoAprovadaId?: string | null },
): OrcamentoInsumoRow[] {
  const aprovadaId = texto(solicitacao.ordemServicoAprovadaId);
  if (aprovadaId) {
    const aprovada = ordens.filter(
      (o) => o.id === aprovadaId || o.legacyId === aprovadaId,
    );
    if (aprovada.length) return aprovada;
  }

  const aprovadas = ordens.filter((o) => texto(o.status) === 'aprovado');
  if (aprovadas.length) return aprovadas;

  return ordens;
}
