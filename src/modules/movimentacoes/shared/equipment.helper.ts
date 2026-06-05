import { NotFoundException } from '@nestjs/common';
import { Query } from 'firebase-admin/firestore';
import { matchesPlateOrChassis } from '../abastecimentos/helpers/abastecimentos-create.helper';

export async function resolveEquipmentIdByPlateOrChassis(
  equipamentosCollection: Query,
  prefeituraId: string,
  plateOrChassis: string,
): Promise<string> {
  const normalizedPrefeituraId = prefeituraId.trim();
  const snap = await equipamentosCollection
    .where('prefeituraId', '==', normalizedPrefeituraId)
    .get();

  const match = snap.docs.find((doc) => {
    const raw = doc.data() as Record<string, unknown>;
    return matchesPlateOrChassis(raw, plateOrChassis);
  });

  if (!match) {
    const globalSnap = await equipamentosCollection.get();
    const globalMatch = globalSnap.docs.find((doc) => {
      const raw = doc.data() as Record<string, unknown>;
      return matchesPlateOrChassis(raw, plateOrChassis);
    });

    if (globalMatch) {
      const raw = globalMatch.data() as { prefeituraId?: string };
      const equipmentPrefeituraId = String(raw.prefeituraId ?? '').trim();
      throw new NotFoundException(
        `Equipamento encontrado, mas não está cadastrado para esta empresa. Prefeitura do equipamento: ${equipmentPrefeituraId || 'não informada'}.`,
      );
    }

    throw new NotFoundException(
      'Equipamento não encontrado ou não cadastrado para esta empresa.',
    );
  }

  const raw = match.data() as { id?: string };
  return raw.id ?? match.id;
}

export async function fetchEquipmentMap(
  equipamentosCollection: Query,
  ids: string[],
): Promise<Map<string, Record<string, unknown>>> {
  const map = new Map<string, Record<string, unknown>>();
  if (!ids.length) return map;

  const snap = await equipamentosCollection
    .where('id', 'in', ids.slice(0, 30))
    .get();

  snap.docs.forEach((doc) => {
    const raw = doc.data() as Record<string, unknown>;
    const id = (raw.id as string) ?? doc.id;
    map.set(id, raw);
  });

  return map;
}
