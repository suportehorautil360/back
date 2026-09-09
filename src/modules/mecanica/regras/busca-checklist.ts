/**
 * Como o texto digitado vira busca.
 *
 * O sistema atual do cliente abre numa caixa só — "Pesquisar por código ou
 * descrição" — e é assim que o mecânico procura: ou ele sabe o número ("roda o
 * 57"), ou lembra do nome ("aquele de esteira"). Duas caixas separadas
 * obrigariam a decidir antes de digitar.
 *
 * Funções puras: nada de Prisma aqui, para o teste provar a regra sem banco.
 */

export type Busca =
  | { tipo: 'vazia' }
  | { tipo: 'codigo'; prefixo: string }
  | { tipo: 'texto'; termo: string };

/**
 * Só dígitos vira busca por código; qualquer letra vira busca por nome.
 *
 * A regra é o primeiro caractere não ser letra, e não "parece número": "57" e
 * "5" são prefixo de código, "5 ton" é texto. Assim digitar o número abre o
 * teclado certo e filtra na hora, sem o app tentar adivinhar.
 */
export function interpretarBusca(entrada: string | undefined): Busca {
  const limpo = (entrada ?? '').trim();
  if (!limpo) return { tipo: 'vazia' };
  if (/^\d+$/.test(limpo)) return { tipo: 'codigo', prefixo: limpo };
  return { tipo: 'texto', termo: limpo };
}

/**
 * Ordena o resultado: o casamento exato de código primeiro, depois o resto por
 * código.
 *
 * Quem digita "57" inteiro quer o 57, não o 570. E quem digita "5" quer ver a
 * lista curta em ordem, porque vai escolher com o olho.
 */
export function ordenarResultado<T extends { codigo: number }>(
  itens: T[],
  busca: Busca,
): T[] {
  const exato = busca.tipo === 'codigo' ? Number(busca.prefixo) : null;
  return [...itens].sort((a, b) => {
    if (exato !== null) {
      if (a.codigo === exato) return -1;
      if (b.codigo === exato) return 1;
    }
    return a.codigo - b.codigo;
  });
}

/**
 * O modelo casa com este equipamento?
 *
 * Sem palavra-chave, vale para qualquer máquina — é o padrão de quem cadastra
 * um checklist genérico e não quer pensar em filtro.
 *
 * Isto ORDENA a busca, não filtra: um checklist que não casa continua
 * aparecendo, mais abaixo. Esconder resultado num app de campo é como o
 * mecânico perde a confiança na ferramenta e liga para o encarregado — que é
 * exatamente o que o produto existe para evitar.
 */
export function casaComEquipamento(
  keywords: unknown,
  equipamento: { descricao?: string | null; modelo?: string | null; tipo?: string | null },
): boolean {
  if (!Array.isArray(keywords) || keywords.length === 0) return true;

  const alvo = [equipamento.descricao, equipamento.modelo, equipamento.tipo]
    .filter((v): v is string => typeof v === 'string')
    .join(' ')
    .toLowerCase();
  if (!alvo.trim()) return false;

  return keywords.some(
    (k) => typeof k === 'string' && k.trim() && alvo.includes(k.trim().toLowerCase()),
  );
}
