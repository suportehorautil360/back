/**
 * O código DA CASA — o que vira a etiqueta de barras.
 *
 * Separado do código do fabricante de propósito: peça usinada ou comprada a
 * granel nunca teve código de fábrica, e peça de caixa já vem com um.
 */

export const PREFIXO_CODIGO_INTERNO = 'ALM-';

const PADRAO = /^ALM-(\d+)$/;

/**
 * O próximo da sequência da empresa. Recebe o ÚLTIMO gravado (o maior), não a
 * lista: quem sabe qual é o último é o banco, com ORDER BY.
 *
 * Código fora do padrão devolve o primeiro em vez de lançar — empresa migrada
 * de planilha tem código de tudo quanto é forma, e travar o cadastro por causa
 * do legado é o defeito pior.
 */
export function proximoCodigoInterno(ultimo: string | null): string {
  const casou = ultimo ? PADRAO.exec(ultimo.trim().toUpperCase()) : null;
  const n = casou ? Number(casou[1]) + 1 : 1;
  return `${PREFIXO_CODIGO_INTERNO}${String(n).padStart(6, '0')}`;
}

/**
 * O que chega do leitor ou do teclado, pronto para comparar.
 *
 * Não remove separador: `32/925994` é o part number real de um filtro, e
 * limpar a barra faria a busca não achar a peça que está na mão da pessoa.
 */
export function normalizarCodigo(bruto: string): string {
  return bruto.trim().toUpperCase().replace(/\s+/g, '');
}
