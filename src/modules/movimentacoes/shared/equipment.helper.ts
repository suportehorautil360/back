import { BadRequestException, NotFoundException } from '@nestjs/common';
import {
  CollectionReference,
  DocumentReference,
  Query,
} from 'firebase-admin/firestore';
import { matchesPlateOrChassis } from '../abastecimentos/helpers/abastecimentos-create.helper';

export interface ResolvedEquipment {
  id: string;
  /** Capacidade do tanque do equipamento (L); 0/ausente = sem limite. */
  capacidadeTanque: number;
  raw: Record<string, unknown>;
  /** Referência do doc — p/ atualizar o equipamento (ex.: medicaoAtual). */
  ref: DocumentReference;
}

/**
 * Resolve o equipamento (dentro da empresa) por placa/chassi e devolve o id + a
 * capacidade do tanque. Use quando precisar validar o quanto cabe (abastecimento).
 */
export async function resolveEquipmentByPlateOrChassis(
  equipamentosCollection: Query,
  prefeituraId: string,
  plateOrChassis: string,
): Promise<ResolvedEquipment> {
  const normalizedPrefeituraId = prefeituraId.trim();
  const snap = await equipamentosCollection
    .where('prefeituraId', '==', normalizedPrefeituraId)
    .get();

  const match = snap.docs.find((doc) => {
    const raw = doc.data() as Record<string, unknown>;
    return matchesPlateOrChassis(raw, plateOrChassis);
  });

  // Só busca dentro da empresa do operador. Não fazemos varredura global: além
  // de ser um scan cross-tenant desnecessário, vazaria o prefeituraId de outra
  // empresa na mensagem de erro. Não encontrou aqui = não encontrado.
  if (!match) {
    throw new NotFoundException(
      'Equipamento não encontrado ou não cadastrado para esta empresa.',
    );
  }

  const raw = match.data() as Record<string, unknown>;
  const capacidade = Number(raw.capacidadeTanque);
  return {
    id: (raw.id as string) ?? match.id,
    capacidadeTanque: Number.isFinite(capacidade) ? capacidade : 0,
    raw,
    ref: match.ref,
  };
}

/** Resolve equipamento pelo id (campo `id` ou doc id), dentro da prefeitura. */
export async function resolveEquipmentById(
  equipamentosCollection: CollectionReference,
  prefeituraId: string,
  equipmentId: string,
): Promise<ResolvedEquipment> {
  const pid = prefeituraId.trim();
  const eid = equipmentId.trim();
  if (!pid || !eid) {
    throw new BadRequestException('Equipamento inválido.');
  }

  const byField = await equipamentosCollection
    .where('prefeituraId', '==', pid)
    .where('id', '==', eid)
    .limit(1)
    .get();

  let match = !byField.empty ? byField.docs[0] : null;
  if (!match) {
    const byDocId = await equipamentosCollection.doc(eid).get();
    if (byDocId.exists) {
      const raw = byDocId.data() as Record<string, unknown>;
      if (String(raw.prefeituraId ?? '').trim() === pid) {
        return {
          id: (raw.id as string) ?? byDocId.id,
          capacidadeTanque: Number.isFinite(Number(raw.capacidadeTanque))
            ? Number(raw.capacidadeTanque)
            : 0,
          raw,
          ref: byDocId.ref,
        };
      }
    }
  }

  if (!match) {
    throw new NotFoundException(
      'Equipamento não encontrado ou não cadastrado para esta empresa.',
    );
  }

  const raw = match.data() as Record<string, unknown>;
  if (String(raw.prefeituraId ?? '').trim() !== pid) {
    throw new NotFoundException(
      'Equipamento não encontrado ou não cadastrado para esta empresa.',
    );
  }

  const capacidade = Number(raw.capacidadeTanque);
  return {
    id: (raw.id as string) ?? match.id,
    capacidadeTanque: Number.isFinite(capacidade) ? capacidade : 0,
    raw,
    ref: match.ref,
  };
}

export async function resolveEquipmentIdByPlateOrChassis(
  equipamentosCollection: Query,
  prefeituraId: string,
  plateOrChassis: string,
): Promise<string> {
  const equip = await resolveEquipmentByPlateOrChassis(
    equipamentosCollection,
    prefeituraId,
    plateOrChassis,
  );
  return equip.id;
}

export async function fetchEquipmentMap(
  equipamentosCollection: CollectionReference,
  ids: string[],
): Promise<Map<string, Record<string, unknown>>> {
  const map = new Map<string, Record<string, unknown>>();
  const uniqueIds = [...new Set(ids.filter(Boolean))];
  if (!uniqueIds.length) return map;

  for (let index = 0; index < uniqueIds.length; index += 30) {
    const batch = uniqueIds.slice(index, index + 30);
    const snap = await equipamentosCollection.where('id', 'in', batch).get();

    snap.docs.forEach((doc) => {
      const raw = doc.data() as Record<string, unknown>;
      const id = (raw.id as string) ?? doc.id;
      map.set(id, raw);
    });
  }

  const missing = uniqueIds.filter((id) => !map.has(id));
  await Promise.all(
    missing.map(async (id) => {
      const doc = await equipamentosCollection.doc(id).get();
      if (!doc.exists) return;

      const raw = doc.data() as Record<string, unknown>;
      const fieldId = (raw.id as string) ?? doc.id;
      map.set(fieldId, raw);
      map.set(id, raw);
    }),
  );

  return map;
}
