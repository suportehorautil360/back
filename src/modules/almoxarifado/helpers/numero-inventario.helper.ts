/**
 * "INV-2026-047". Mesma forma de `numero-requisicao.helper.ts`, e existe pelo
 * mesmo motivo: o MAX tem de ser tirado em NÚMERO. `ORDER BY numero DESC`
 * sobre uma coluna TEXT compara caractere a caractere, e a partir da 999ª
 * contagem do ano o MAX aparente trava para sempre.
 */
export function parseNumeroInventarioSeq(numero: string, ano: number): number | null {
  const m = new RegExp(`^INV-${ano}-(\\d+)$`).exec(numero.trim());
  if (!m) return null;
  const seq = Number(m[1]);
  return Number.isFinite(seq) ? seq : null;
}

/** `padStart` nunca TRUNCA — só completa até a largura mínima. */
export function formatNumeroInventario(ano: number, seq: number): string {
  return `INV-${ano}-${String(seq).padStart(3, '0')}`;
}
