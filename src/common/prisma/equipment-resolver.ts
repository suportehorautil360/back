import {
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import type { PrismaService } from '../../prisma/prisma.service';
import {
  ehComboioTipo,
  mapEquipmentToApi,
} from './equipment-api.mapper';
import { companyWhere } from './company-resolver';
import { matchesPlateOrChassis } from '../../modules/movimentacoes/abastecimentos/helpers/abastecimentos-create.helper';

export interface ResolvedEquipmentPg {
  /** ID público (legacyId ?? uuid) — compat com Firestore/API legada. */
  id: string;
  equipmentUuid: string;
  capacidadeTanque: number;
  raw: Record<string, unknown>;
}

type EquipmentRow = NonNullable<
  Awaited<ReturnType<PrismaService['equipment']['findFirst']>>
>;

function mapRow(
  row: EquipmentRow,
  prefeituraId: string,
): ResolvedEquipmentPg {
  const raw = mapEquipmentToApi(row, prefeituraId) as Record<string, unknown>;
  raw.capacidadeTanqueCaminhao = row.capacidadeTanqueCaminhao ?? null;
  const capacidade = Number(raw.capacidadeTanque);
  return {
    id: String(raw.id),
    equipmentUuid: row.id,
    capacidadeTanque: Number.isFinite(capacidade) ? capacidade : 0,
    raw,
  };
}

export async function resolveEquipmentByPlateOrChassisPg(
  prisma: PrismaService,
  prefeituraId: string,
  plateOrChassis: string,
): Promise<ResolvedEquipmentPg> {
  const pid = prefeituraId.trim();
  if (!pid || !plateOrChassis?.trim()) {
    throw new BadRequestException('Equipamento inválido.');
  }

  const rows = await prisma.equipment.findMany({
    where: { company: companyWhere(pid) },
  });

  const match = rows.find((row) =>
    matchesPlateOrChassis(mapEquipmentToApi(row, pid), plateOrChassis),
  );

  if (!match) {
    throw new NotFoundException(
      'Equipamento não encontrado ou não cadastrado para esta empresa.',
    );
  }

  return mapRow(match, pid);
}

export async function resolveEquipmentByIdPg(
  prisma: PrismaService,
  prefeituraId: string,
  equipmentId: string,
): Promise<ResolvedEquipmentPg> {
  const pid = prefeituraId.trim();
  const eid = equipmentId.trim();
  if (!pid || !eid) {
    throw new BadRequestException('Equipamento inválido.');
  }

  const row = await prisma.equipment.findFirst({
    where: {
      company: companyWhere(pid),
      OR: [{ id: eid }, { legacyId: eid }],
    },
  });

  if (!row) {
    throw new NotFoundException(
      'Equipamento não encontrado ou não cadastrado para esta empresa.',
    );
  }

  return mapRow(row, pid);
}

export async function resolveEquipmentIdByPlateOrChassisPg(
  prisma: PrismaService,
  prefeituraId: string,
  plateOrChassis: string,
): Promise<string> {
  const equip = await resolveEquipmentByPlateOrChassisPg(
    prisma,
    prefeituraId,
    plateOrChassis,
  );
  return equip.id;
}

export async function fetchEquipmentMapPg(
  prisma: PrismaService,
  ids: string[],
): Promise<Map<string, Record<string, unknown>>> {
  const map = new Map<string, Record<string, unknown>>();
  const uniqueIds = [...new Set(ids.filter(Boolean))];
  if (!uniqueIds.length) return map;

  const rows = await prisma.equipment.findMany({
    where: {
      OR: [{ id: { in: uniqueIds } }, { legacyId: { in: uniqueIds } }],
    },
    include: { company: { select: { legacyId: true } } },
  });

  for (const row of rows) {
    const prefeituraId = row.company.legacyId ?? row.companyId;
    const raw = mapEquipmentToApi(row, prefeituraId) as Record<string, unknown>;
    raw.capacidadeTanqueCaminhao = row.capacidadeTanqueCaminhao ?? null;
    const publicId = String(raw.id);
    map.set(publicId, raw);
    map.set(row.id, raw);
    if (row.legacyId) map.set(row.legacyId, raw);
  }

  return map;
}

export async function atualizarMedicaoAtualPg(
  prisma: PrismaService,
  equipmentPublicId: string,
  leitura: number,
): Promise<void> {
  const row = await prisma.equipment.findFirst({
    where: { OR: [{ id: equipmentPublicId }, { legacyId: equipmentPublicId }] },
    select: { id: true, medicaoAtual: true },
  });
  if (!row) return;
  const atual = Number(row.medicaoAtual);
  if (!Number.isFinite(atual) || leitura > atual) {
    await prisma.equipment.update({
      where: { id: row.id },
      data: { medicaoAtual: leitura },
    });
  }
}

export async function ensureTankForComboioPg(
  prisma: PrismaService,
  equipmentUuid: string,
): Promise<void> {
  const row = await prisma.equipment.findUnique({
    where: { id: equipmentUuid },
    select: { id: true, tipo: true, volumeTanqueAtual: true },
  });
  if (!row || !ehComboioTipo(row.tipo)) return;
  if (row.volumeTanqueAtual === null) {
    await prisma.equipment.update({
      where: { id: row.id },
      data: { volumeTanqueAtual: 0 },
    });
  }
}
