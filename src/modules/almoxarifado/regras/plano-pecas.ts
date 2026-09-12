/**
 * A ponte entre a matriz preventiva e o almoxarifado.
 *
 * O plano é uma coluna Json editada por import de PDF: nada aqui confia no
 * formato. Puro, e espelhado no painel — o que NÃO se duplica é a escrita.
 */
import { normalizarCodigo } from './codigo';

/** As duas únicas ações que tiram peça da prateleira. */
const ACOES_QUE_CONSOMEM = new Set(['trocar', 'medir_trocar']);

export interface LinhaDoPlano {
  id?: string;
  item?: string;
  especificacao?: string;
  codigoPeca?: string;
  quantidade?: string;
  /** Vínculo EXPLÍCITO com o catálogo, preenchido na tela do plano. */
  pecaId?: string;
  /** Se a falta desta linha impede começar o serviço. */
  impeditivo?: boolean;
  acoes?: Record<string, string>;
}

export interface ItemDeTroca {
  linhaId: string;
  descricao: string;
  codigoPeca: string | null;
  pecaId: string | null;
  quantidade: number;
  unidade: string | null;
  impeditivo: boolean;
}

export interface PecaDoCatalogo {
  id: string;
  codigoInterno: string;
  codigoFabricante: string | null;
}

function texto(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

function lista<T>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}

/**
 * Quantidade do plano é TEXTO — "1", "80L", "2,5 L", "conforme manual".
 *
 * Sem número, vale 1 e o texto inteiro vira unidade: o plano omite a
 * quantidade quando é uma peça só, e devolver 0 faria a OS não reservar nada.
 */
export function parseQuantidade(bruto?: string): {
  valor: number;
  unidade: string | null;
} {
  const s = texto(bruto);
  if (!s) return { valor: 1, unidade: null };
  const m = /^(\d+(?:[.,]\d+)?)\s*(.*)$/.exec(s);
  if (!m) return { valor: 1, unidade: s };
  const resto = m[2].trim();
  return { valor: Number(m[1].replace(',', '.')), unidade: resto || null };
}

/**
 * `pecaId` explícito é verdade; código é fallback.
 *
 * Código AMBÍGUO devolve `null` de propósito: `codigo_fabricante` não é único,
 * e escolher a primeira entregaria a marca errada sem ninguém perceber.
 */
export function resolverPeca(
  linha: Pick<LinhaDoPlano, 'pecaId' | 'codigoPeca'>,
  catalogo: PecaDoCatalogo[],
): string | null {
  const explicito = texto(linha.pecaId);
  if (explicito) return explicito;

  const alvo = normalizarCodigo(texto(linha.codigoPeca));
  if (!alvo) return null;

  const casam = catalogo.filter(
    (p) =>
      normalizarCodigo(p.codigoInterno) === alvo ||
      (p.codigoFabricante && normalizarCodigo(p.codigoFabricante) === alvo),
  );
  return casam.length === 1 ? casam[0].id : null;
}

export function itensDeTrocaDoCiclo(
  categorias: unknown,
  categoriaId: string,
  cicloId: string,
): ItemDeTroca[] {
  const cat = lista<{ id?: string; ciclos?: unknown; linhas?: unknown }>(
    categorias,
  ).find((c) => texto(c.id) === categoriaId.trim());
  if (!cat) return [];

  const ciclo = lista<{ id?: string }>(cat.ciclos).find(
    (c) => texto(c.id) === cicloId.trim(),
  );
  if (!ciclo) return [];

  const chave = texto(ciclo.id);
  const itens: ItemDeTroca[] = [];

  for (const linha of lista<LinhaDoPlano>(cat.linhas)) {
    const acao = texto(linha.acoes?.[chave]).toLowerCase();
    if (!ACOES_QUE_CONSOMEM.has(acao)) continue;
    const { valor, unidade } = parseQuantidade(linha.quantidade);
    itens.push({
      linhaId: texto(linha.id) || `l${itens.length + 1}`,
      descricao: texto(linha.item) || 'Item sem descrição',
      codigoPeca: texto(linha.codigoPeca) || null,
      pecaId: texto(linha.pecaId) || null,
      quantidade: valor,
      unidade,
      // Sem marcação no plano, o item NÃO impede. O padrão permissivo é o
      // seguro: travar a OS por uma linha que ninguém classificou ensinaria
      // a contornar o sistema.
      impeditivo: linha.impeditivo === true,
    });
  }
  return itens;
}
