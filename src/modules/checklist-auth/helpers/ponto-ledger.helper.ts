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

/**
 * Grava uma batida ORIGINAL selando o NSR e o hash encadeado.
 *
 * Aqui, e não em cada chamador, porque o selo é a prova de que o registro não
 * foi alterado (Portaria 671): duas implementações da mesma cadeia divergem na
 * primeira mudança, e o que se perde é justamente a verificabilidade.
 *
 * O `SELECT ... FOR UPDATE` no contador é o que serializa duas batidas
 * simultâneas da mesma empresa. Sem ele, as duas leriam o mesmo `ultimo`, e a
 * cadeia de hash nasceria com dois elos apontando para o mesmo anterior.
 *
 * `timestampOriginal` vem de QUEM BATEU, nunca do relógio do servidor: uma
 * batida feita às 7h no galpão e sincronizada ao meio-dia registra 7h. É o
 * horário que a lei protege.
 */
export async function selarBatidaOriginal(
  tx: {
    pontoNsrCounter: {
      upsert: (args: unknown) => Promise<unknown>;
      findUniqueOrThrow: (args: unknown) => Promise<{
        ultimo: number;
        ultimoHash: string | null;
      }>;
      update: (args: unknown) => Promise<unknown>;
    };
    $executeRawUnsafe: (sql: string, ...valores: unknown[]) => Promise<number>;
  },
  entrada: {
    companyId: string;
    /** CPF só de dígitos quando houver; senão o nome. Entra no hash. */
    identificador: string;
    tipo: string;
    /** ISO do APARELHO. */
    timestampOriginal: string;
  },
): Promise<{ nsr: number; hash: string; hashAnterior: string | null }> {
  await tx.pontoNsrCounter.upsert({
    where: { companyId: entrada.companyId },
    create: { companyId: entrada.companyId, ultimo: 0, ultimoHash: null },
    update: {},
  });

  await tx.$executeRawUnsafe(
    'SELECT 1 FROM ponto_nsr_counters WHERE company_id = $1::uuid FOR UPDATE',
    entrada.companyId,
  );

  const counter = await tx.pontoNsrCounter.findUniqueOrThrow({
    where: { companyId: entrada.companyId },
  });

  const nsr = counter.ultimo + 1;
  const hashAnterior = counter.ultimoHash ?? '';
  const hash = calcularHashPonto(
    nsr,
    entrada.companyId,
    entrada.identificador,
    entrada.tipo,
    formatTimestampForLedger(entrada.timestampOriginal),
    hashAnterior,
  );

  await tx.pontoNsrCounter.update({
    where: { companyId: entrada.companyId },
    data: { ultimo: nsr, ultimoHash: hash },
  });

  return { nsr, hash, hashAnterior: hashAnterior || null };
}
