import type { PrismaService } from '../../prisma/prisma.service';

export function publicLegacyId(row: {
  id: string;
  legacyId: string | null;
}): string {
  return row.legacyId ?? row.id;
}

export function serviceOrderWhere(idOuLegacy: string) {
  const id = idOuLegacy.trim();
  if (!id) return { id: '__invalid__' };
  return { OR: [{ id }, { legacyId: id }] };
}

export function orcamentoWhere(idOuLegacy: string) {
  const id = idOuLegacy.trim();
  if (!id) return { id: '__invalid__' };
  return { OR: [{ id }, { legacyId: id }] };
}

export async function resolveServiceOrderPg(
  prisma: PrismaService,
  idOuLegacy: string,
) {
  return prisma.serviceOrder.findFirst({
    where: serviceOrderWhere(idOuLegacy),
    include: {
      company: { select: { id: true, legacyId: true } },
    },
  });
}

export async function resolveOrcamentoPg(
  prisma: PrismaService,
  idOuLegacy: string,
) {
  return prisma.orcamento.findFirst({
    where: orcamentoWhere(idOuLegacy),
    include: {
      serviceOrder: {
        select: { id: true, legacyId: true, status: true },
      },
    },
  });
}
