/**
 * Ledger de ponto (Portaria MTE 671/2021 — REP-P).
 *
 * Toda marcação vira um registro **imutável** com:
 *  - NSR (Número Sequencial de Registro): sequencial POR EMPREGADOR
 *    (prefeituraId), nunca repete e nunca reinicia;
 *  - hash SHA-256 ENCADEADO ao registro anterior (estilo blockchain), o que
 *    torna qualquer adulteração detectável.
 *
 * O contador e o "topo" da cadeia ficam em `nsrCounters/{prefeituraId}`
 * (`{ ultimo, ultimoHash }`) e são atualizados na MESMA transação em que o
 * registro é gravado — assim NSR e hash não sofrem corrida sob concorrência.
 */
import { createHash } from 'node:crypto';
import type { Firestore } from 'firebase-admin/firestore';

/** Natureza do registro no ledger. A `original` nunca é alterada nem apagada. */
export type RegistroLedger = 'original' | 'ajuste' | 'cancelamento';

/** Campos que entram no cálculo do hash (a "prova" do registro). */
export interface PayloadLedger {
  prefeituraId: string;
  /** Identificador do trabalhador na marcação (CPF/PIS quando houver, senão nome). */
  identificador: string;
  tipo: string;
  /** Horário da marcação (ISO 8601) — imutável. */
  timestampOriginal: string;
  registro: RegistroLedger;
  /** NSR da batida original alvo (para ajuste/cancelamento). */
  refNsr?: number | null;
}

export interface RegistroSelado {
  nsr: number;
  hash: string;
  hashAnterior: string;
}

/** Serialização canônica e estável dos campos que compõem o hash. */
function canonical(nsr: number, p: PayloadLedger): string {
  return JSON.stringify([
    nsr,
    p.prefeituraId,
    p.identificador,
    p.tipo,
    p.timestampOriginal,
    p.registro,
    p.refNsr ?? null,
  ]);
}

/** Hash do registro: SHA-256 sobre o payload canônico encadeado ao anterior. */
export function calcularHash(
  nsr: number,
  payload: PayloadLedger,
  hashAnterior: string,
): string {
  return createHash('sha256')
    .update(`${hashAnterior}|${canonical(nsr, payload)}`)
    .digest('hex');
}

/**
 * Reserva o próximo NSR da prefeitura e calcula o hash encadeado, de forma
 * atômica. Retorna `{ nsr, hash, hashAnterior }` para o chamador montar e
 * gravar o documento do registro com esses selos.
 *
 * Use SEMPRE dentro do mesmo `runTransaction` que grava a marcação, passando
 * a própria transação, para que contador, cadeia e registro avancem juntos.
 */
export async function selarRegistro(
  db: Firestore,
  tx: FirebaseFirestore.Transaction,
  payload: PayloadLedger,
): Promise<RegistroSelado> {
  const counterRef = db.collection('nsrCounters').doc(payload.prefeituraId);
  const snap = await tx.get(counterRef);
  const atual = snap.exists
    ? (snap.data() as { ultimo?: number; ultimoHash?: string })
    : {};
  const ultimo = typeof atual.ultimo === 'number' ? atual.ultimo : 0;
  const hashAnterior = atual.ultimoHash ?? '';

  const nsr = ultimo + 1;
  const hash = calcularHash(nsr, payload, hashAnterior);

  tx.set(counterRef, { ultimo: nsr, ultimoHash: hash }, { merge: true });

  return { nsr, hash, hashAnterior };
}
