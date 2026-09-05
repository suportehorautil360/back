/**
 * Posição de leitura do `/sync/pull`.
 *
 * O cursor é OPACO de propósito: o app nunca monta `updated_at > X` sozinho.
 * Quem decide a estratégia de paginação é o servidor, e assim ela pode mudar
 * sem quebrar aparelho que já está em campo.
 */

export type PosicaoDoCursor = {
  atualizadoEm: Date;
  /** Desempata registros gravados no mesmo milissegundo. */
  id: string;
};

export function codificarCursor(p: PosicaoDoCursor): string {
  const payload = JSON.stringify({ t: p.atualizadoEm.toISOString(), i: p.id });
  return Buffer.from(payload, 'utf8').toString('base64url');
}

/**
 * Devolve `null` para ausente OU corrompido — nos dois casos o pull recomeça
 * do zero. Recomeçar é caro; estourar deixaria o operador sem frota nenhuma.
 */
export function decodificarCursor(
  cursor: string | undefined | null,
): PosicaoDoCursor | null {
  if (!cursor) return null;
  try {
    const bruto = Buffer.from(cursor, 'base64url').toString('utf8');
    const { t, i } = JSON.parse(bruto) as { t?: unknown; i?: unknown };
    if (typeof t !== 'string' || typeof i !== 'string') return null;
    const atualizadoEm = new Date(t);
    if (Number.isNaN(atualizadoEm.getTime())) return null;
    return { atualizadoEm, id: i };
  } catch {
    return null;
  }
}
