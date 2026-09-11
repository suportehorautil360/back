/**
 * Qual checklist do operador vale para uma empresa.
 *
 * ESPELHO de `horautil/lib/company/checklist-do-operador.ts` — o painel e o
 * PWA com sessão resolvem lá; o login por CHASSI chega aqui, e as duas
 * respostas têm de ser a mesma. Mudou lá, muda aqui (e os testes dos dois
 * lados dizem as mesmas coisas).
 *
 * A regra: para a mesma categoria, o da empresa SUBSTITUI o base. Arquivado
 * da empresa também substitui — e some: é a empresa dizendo que não usa
 * aquela categoria, e o base não volta no lugar. Base arquivado não concorre.
 * De outra empresa é descartado.
 */

interface DefinicaoComEscopo {
  categoria: string;
  companyId: string | null;
  ativo: boolean;
}

/** "Pá Carregadeira", "pa carregadeira" e "PÁ CARREGADEIRA " são a mesma. */
export function chaveDeCategoria(categoria: string): string {
  return categoria
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

export function resolverParaEmpresa<T extends DefinicaoComEscopo>(
  definicoes: T[],
  companyId: string,
): T[] {
  const porCategoria = new Map<string, T>();

  for (const def of definicoes) {
    if (def.companyId && def.companyId !== companyId) continue;
    if (!def.ativo && !def.companyId) continue;

    const chave = chaveDeCategoria(def.categoria);
    if (!chave) continue;

    const atual = porCategoria.get(chave);
    if (!atual || (!atual.companyId && def.companyId)) {
      porCategoria.set(chave, def);
    }
  }

  return [...porCategoria.values()].filter((d) => d.ativo);
}
