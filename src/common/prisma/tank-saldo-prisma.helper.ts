import { BadRequestException } from '@nestjs/common';
import type { Prisma } from '../../prisma/generated/client';
import { ehComboioTipo } from './equipment-api.mapper';

function numero(valor: unknown): number {
  const n = Number(valor);
  return Number.isFinite(n) ? n : 0;
}

async function findComboio(
  tx: Prisma.TransactionClient,
  comboioId: string,
) {
  return tx.equipment.findFirst({
    where: { OR: [{ id: comboioId }, { legacyId: comboioId }] },
  });
}

/** Percentual e status do tanque (mesma régua do dashboard). */
export function tankStatusPg(
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

export async function debitarTanquePrismaTx(
  tx: Prisma.TransactionClient,
  comboioId: string,
  litros: number,
): Promise<void> {
  if (!comboioId) {
    throw new BadRequestException(
      'Comboio não informado para o abastecimento.',
    );
  }
  if (!Number.isFinite(litros) || litros <= 0) return;

  const equip = await findComboio(tx, comboioId);
  if (!equip || !ehComboioTipo(equip.tipo)) {
    throw new BadRequestException(
      'Tanque do comboio não encontrado. Edite o comboio no cadastro para criá-lo.',
    );
  }

  const saldo = numero(equip.volumeTanqueAtual);
  if (saldo - litros < 0) {
    throw new BadRequestException(
      `Saldo insuficiente no tanque do comboio: ${saldo} L disponível(is), ${litros} L solicitado(s).`,
    );
  }

  await tx.equipment.update({
    where: { id: equip.id },
    data: { volumeTanqueAtual: saldo - litros },
  });
}

export async function creditarTanquePrismaTx(
  tx: Prisma.TransactionClient,
  comboioId: string,
  litros: number,
): Promise<void> {
  if (!comboioId) {
    throw new BadRequestException(
      'Comboio não informado para o reabastecimento.',
    );
  }
  if (!Number.isFinite(litros) || litros <= 0) return;

  const equip = await findComboio(tx, comboioId);
  if (!equip || !ehComboioTipo(equip.tipo)) {
    throw new BadRequestException('Comboio não encontrado.');
  }

  const saldo = numero(equip.volumeTanqueAtual);
  const capacidade = numero(equip.capacidadeTanque);

  if (capacidade > 0 && saldo + litros > capacidade) {
    const cabe = Math.max(0, capacidade - saldo);
    throw new BadRequestException(
      `Capacidade do tanque excedida: ${saldo} L no tanque, capacidade ${capacidade} L. ` +
        `Cabe no máximo ${cabe} L (tentou adicionar ${litros} L).`,
    );
  }

  await tx.equipment.update({
    where: { id: equip.id },
    data: { volumeTanqueAtual: saldo + litros },
  });
}

export async function creditarTanquePrisma(
  prisma: { equipment: Prisma.TransactionClient['equipment'] },
  comboioId: string,
  litros: number,
): Promise<void> {
  if (!comboioId || !Number.isFinite(litros) || litros <= 0) return;
  const equip = await prisma.equipment.findFirst({
    where: { OR: [{ id: comboioId }, { legacyId: comboioId }] },
  });
  if (!equip) return;
  const saldo = numero(equip.volumeTanqueAtual);
  await prisma.equipment.update({
    where: { id: equip.id },
    data: { volumeTanqueAtual: saldo + litros },
  });
}
