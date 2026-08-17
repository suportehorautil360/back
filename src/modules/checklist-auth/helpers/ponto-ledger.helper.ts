import { createHash } from 'node:crypto';

export type RegistroLedger = 'original' | 'ajuste' | 'cancelamento';

/** Formato canônico do timestamp no hash (espelha a RPC `bater_ponto`). */
export function formatTimestampForLedger(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    throw new Error('timestampOriginal inválido');
  }
  const y = d.getUTCFullYear();
  const mo = String(d.getUTCMonth() + 1).padStart(2, '0');
  const da = String(d.getUTCDate()).padStart(2, '0');
  const h = String(d.getUTCHours()).padStart(2, '0');
  const mi = String(d.getUTCMinutes()).padStart(2, '0');
  const s = String(d.getUTCSeconds()).padStart(2, '0');
  const ms = String(d.getUTCMilliseconds()).padStart(3, '0');
  return `${y}-${mo}-${da}T${h}:${mi}:${s}.${ms}Z`;
}

export function calcularHashPontoLedger(
  nsr: number,
  companyId: string,
  identificador: string,
  tipo: string,
  timestampOriginal: string,
  hashAnterior: string,
  registro: RegistroLedger = 'original',
  refNsr: number | null = null,
): string {
  const payload = JSON.stringify([
    nsr,
    companyId,
    identificador,
    tipo,
    timestampOriginal,
    registro,
    refNsr,
  ]);
  return createHash('sha256')
    .update(`${hashAnterior}|${payload}`)
    .digest('hex');
}

export function calcularHashPonto(
  nsr: number,
  companyId: string,
  identificador: string,
  tipo: string,
  timestampOriginal: string,
  hashAnterior: string,
): string {
  return calcularHashPontoLedger(
    nsr,
    companyId,
    identificador,
    tipo,
    timestampOriginal,
    hashAnterior,
    'original',
    null,
  );
}
