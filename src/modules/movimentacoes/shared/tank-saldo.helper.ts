import { BadRequestException } from '@nestjs/common';
import * as admin from 'firebase-admin';

type Firestore = admin.firestore.Firestore;
type Transaction = admin.firestore.Transaction;

/**
 * Saldo do tanque do comboio. Cada comboio (equipamento `tipo: Comboio`) tem um
 * tanque próprio na coleção `tanks`, com o doc **keyed pelo `comboioId`** (1:1).
 *
 * Convenção: crédito soma (reabastecimento do comboio), débito desconta
 * (abastecimento de equipamento a partir do comboio). O débito é transacional e
 * **trava o saldo negativo** — não deixa abastecer mais do que o tanque tem.
 */

function tankRef(firestore: Firestore, comboioId: string) {
  return firestore.collection('tanks').doc(comboioId);
}

/** Percentual e status do tanque a partir de capacidade/volume (mesma régua do dashboard). */
export function tankStatus(
  capacity: unknown,
  currentVolume: unknown,
): { percentage: number; status: 'Normal' | 'Moderate' | 'Critic' } {
  const cap = numero(capacity);
  const vol = numero(currentVolume);
  const percentage = cap > 0 ? (vol / cap) * 100 : 0;
  let status: 'Normal' | 'Moderate' | 'Critic' = 'Normal';
  if (percentage <= 20) status = 'Critic';
  else if (percentage <= 60) status = 'Moderate';
  return { percentage, status };
}

function texto(valor: unknown): string {
  return typeof valor === 'string' ? valor : '';
}

function numero(valor: unknown): number {
  const n = Number(valor);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Garante o doc de tanque do comboio (id = comboioId). Cria com volume zero na
 * primeira vez; nas demais preserva o `currentVolume` e só atualiza metadados e
 * capacidade. Chamado ao criar/editar um equipamento `tipo: Comboio`.
 */
export async function ensureTankForComboio(
  firestore: Firestore,
  equip: Record<string, unknown>,
): Promise<void> {
  const comboioId = texto(equip.id);
  if (!comboioId) return;

  const ref = tankRef(firestore, comboioId);
  const base = {
    comboioId,
    prefeituraId: texto(equip.prefeituraId),
    capacity: numero(equip.capacidadeTanque),
    name: texto(equip.descricao) || texto(equip.modelo) || 'Comboio',
    fuelType: texto(equip.combustivel),
    veiculoModelo: texto(equip.modelo) || texto(equip.descricao),
    veiculoPlaca: texto(equip.placa),
    veiculoChassis: texto(equip.chassis),
  };

  const snap = await ref.get();
  if (!snap.exists) {
    await ref.set({
      ...base,
      currentVolume: 0,
      createdAt: new Date().toISOString(),
    });
    return;
  }
  // Preserva o currentVolume já existente; atualiza só os metadados/capacidade.
  await ref.set(
    { ...base, updatedAt: new Date().toISOString() },
    { merge: true },
  );
}

/**
 * Soma litros no tanque do comboio (reabastecimento). Incremento atômico via
 * `FieldValue.increment`. Best-effort: não trava nada (encher sempre é válido).
 */
export async function creditarTanque(
  firestore: Firestore,
  comboioId: string,
  litros: number,
): Promise<void> {
  if (!comboioId || !Number.isFinite(litros) || litros <= 0) return;
  await tankRef(firestore, comboioId).set(
    {
      comboioId,
      currentVolume: admin.firestore.FieldValue.increment(litros),
    },
    { merge: true },
  );
}

/**
 * Desconta litros do tanque do comboio **dentro de uma transação já aberta** —
 * lê o saldo, rejeita (`BadRequestException`) se ficar negativo e agenda o
 * decremento. Use quando o débito precisa ser atômico com outra escrita (gravar
 * o abastecimento junto). Em transação do Firestore, leituras vêm antes das
 * escritas: chame esta função antes de qualquer `tx.set`/`tx.update`.
 */
export async function debitarTanqueTx(
  tx: Transaction,
  firestore: Firestore,
  comboioId: string,
  litros: number,
): Promise<void> {
  if (!comboioId) {
    throw new BadRequestException(
      'Comboio não informado para o abastecimento.',
    );
  }
  if (!Number.isFinite(litros) || litros <= 0) return;

  const ref = tankRef(firestore, comboioId);
  const snap = await tx.get(ref);
  if (!snap.exists) {
    throw new BadRequestException(
      'Tanque do comboio não encontrado. Edite o comboio no cadastro para criá-lo.',
    );
  }

  const saldo = numero(
    (snap.data() as { currentVolume?: unknown }).currentVolume,
  );
  if (saldo - litros < 0) {
    throw new BadRequestException(
      `Saldo insuficiente no tanque do comboio: ${saldo} L disponível(is), ${litros} L solicitado(s).`,
    );
  }

  tx.update(ref, {
    currentVolume: admin.firestore.FieldValue.increment(-litros),
  });
}
