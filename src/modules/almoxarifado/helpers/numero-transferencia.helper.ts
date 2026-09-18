/**
 * "TRF-2026-047". Mesma forma de `numero-requisicao.helper.ts` e
 * `numero-inventario.helper.ts`, e existe pelo mesmo motivo: o MAX tem de ser
 * tirado em NÚMERO. `ORDER BY numero DESC` sobre uma coluna TEXT compara
 * caractere a caractere, e a partir da 999ª transferência do ano o MAX
 * aparente trava para sempre.
 */
export function parseNumeroTransferenciaSeq(numero: string, ano: number): number | null {
  // Ano não inteiro vira metacaractere no padrão (e.g. `2026.5` → `.` casa qualquer char).
  if (!Number.isInteger(ano)) return null;
  const m = new RegExp(`^TRF-${ano}-(\\d+)$`).exec(numero.trim());
  if (!m) return null;
  const seq = Number(m[1]);
  return Number.isFinite(seq) ? seq : null;
}

/** `padStart` nunca TRUNCA — só completa até a largura mínima. */
export function formatNumeroTransferencia(ano: number, seq: number): string {
  return `TRF-${ano}-${String(seq).padStart(3, '0')}`;
}
