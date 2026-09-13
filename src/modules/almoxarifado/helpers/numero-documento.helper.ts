/**
 * "SC-2026-001", "OC-2026-001" — número humano-legível dos documentos de
 * compra. Mesma forma, e pela mesma razão, de `numero-requisicao.helper.ts`:
 * `ORDER BY numero DESC` numa coluna TEXT compara caractere a caractere, e a
 * partir do 1000º documento do ano o MAX aparente travaria em 999 para sempre.
 * Quem chama busca TODOS os números do ano com o prefixo e tira o maior em
 * NÚMERO com `parseNumeroDocumentoSeq`.
 */
export type PrefixoDocumento = 'SC' | 'OC';

export function parseNumeroDocumentoSeq(
  prefixo: PrefixoDocumento,
  numero: string,
  ano: number,
): number | null {
  const m = new RegExp(`^${prefixo}-${ano}-(\\d+)$`).exec(numero.trim());
  if (!m) return null;
  const seq = Number(m[1]);
  return Number.isFinite(seq) ? seq : null;
}

/** `padStart` nunca trunca: o 1000º sai "OC-2026-1000". */
export function formatNumeroDocumento(prefixo: PrefixoDocumento, ano: number, seq: number): string {
  return `${prefixo}-${ano}-${String(seq).padStart(3, '0')}`;
}

/** O próximo número a partir de todos os já gravados no ano. */
export function proximoNumeroDocumento(prefixo: PrefixoDocumento, ano: number, existentes: string[]): string {
  let maior = 0;
  for (const numero of existentes) {
    const seq = parseNumeroDocumentoSeq(prefixo, numero, ano);
    if (seq !== null && seq > maior) maior = seq;
  }
  return formatNumeroDocumento(prefixo, ano, maior + 1);
}
