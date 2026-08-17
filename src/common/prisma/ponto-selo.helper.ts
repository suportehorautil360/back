import type { Prisma } from '../../prisma/generated/client';
import {
  calcularHashPontoLedger,
  formatTimestampForLedger,
  type RegistroLedger,
} from '../../modules/checklist-auth/helpers/ponto-ledger.helper';

export interface SeloPontoPayload {
  identificador: string;
  tipo: string;
  /** ISO 8601 da marcação. */
  timestampOriginal: string;
  registro: RegistroLedger;
  refNsr?: number | null;
}

export interface SeloPontoResult {
  nsr: number;
  hash: string;
  hashAnterior: string;
}

/** Reserva NSR + hash encadeado (Portaria 671) dentro da transação Prisma. */
export async function selarRegistroPostgres(
  tx: Prisma.TransactionClient,
  companyId: string,
  payload: SeloPontoPayload,
): Promise<SeloPontoResult> {
  await tx.pontoNsrCounter.upsert({
    where: { companyId },
    create: { companyId, ultimo: 0, ultimoHash: null },
    update: {},
  });
  await tx.$executeRaw`
    SELECT 1 FROM ponto_nsr_counters
    WHERE company_id = ${companyId}::uuid
    FOR UPDATE
  `;

  const counter = await tx.pontoNsrCounter.findUniqueOrThrow({
    where: { companyId },
  });

  const nextNsr = counter.ultimo + 1;
  const hashAnterior = counter.ultimoHash ?? '';
  const tsLedger = formatTimestampForLedger(payload.timestampOriginal);
  const hash = calcularHashPontoLedger(
    nextNsr,
    companyId,
    payload.identificador,
    payload.tipo,
    tsLedger,
    hashAnterior,
    payload.registro,
    payload.refNsr ?? null,
  );

  await tx.pontoNsrCounter.update({
    where: { companyId },
    data: { ultimo: nextNsr, ultimoHash: hash },
  });

  return { nsr: nextNsr, hash, hashAnterior };
}
