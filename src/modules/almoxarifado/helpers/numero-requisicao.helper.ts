/**
 * "REQ-2026-047" — número humano-legível da requisição de material. Mesma
 * forma de `parseProtocolSeq`/`formatProtocol`
 * (`../../os/helpers/gerar-protocolo.helper.ts`), que resolve o mesmo
 * problema para o protocolo da OS.
 *
 * Existe porque `orderBy: { numero: 'desc' }` sobre uma coluna TEXT compara
 * caractere a caractere: com "REQ-2026-999" no banco, "REQ-2026-1000" viria
 * ANTES dele nessa ordem ('9' > '1'), então o MAX aparente trava em 999 para
 * sempre a partir da 999ª requisição do ano — cada tentativa seguinte
 * recalcula o mesmo número já usado, uma colisão de unique ETERNA (achado
 * Critical C1 da revisão da Task 9). O MAX tem que ser tirado em NÚMERO, não
 * em string — daí `parseNumeroRequisicaoSeq` (extrai o sufixo) e o chamador
 * tirando o maior com `Math.max`/loop, nunca com `ORDER BY`/`desc` no texto.
 */
export function parseNumeroRequisicaoSeq(numero: string, ano: number): number | null {
  const m = new RegExp(`^REQ-${ano}-(\\d+)$`).exec(numero.trim());
  if (!m) return null;
  const seq = Number(m[1]);
  return Number.isFinite(seq) ? seq : null;
}

/**
 * `padStart` nunca TRUNCA — só completa até a largura mínima. "1000" já tem
 * 4 caracteres e sai como "1000"; não há como essa formatação perder dígito.
 */
export function formatNumeroRequisicao(ano: number, seq: number): string {
  return `REQ-${ano}-${String(seq).padStart(3, '0')}`;
}
