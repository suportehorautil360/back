import type { PrismaService } from '../../prisma/prisma.service';
import { isUuid } from './company-resolver';

export function workFrontWhere(idOuLegacy: string) {
  const id = idOuLegacy.trim();
  if (!id) return { id: '__invalid__' };
  if (isUuid(id)) {
    return { OR: [{ id }, { legacyId: id }] };
  }
  return { legacyId: id };
}

export function allocationWhere(idOuLegacy: string) {
  const id = idOuLegacy.trim();
  if (!id) return { id: '__invalid__' };
  if (isUuid(id)) {
    return { OR: [{ id }, { legacyId: id }] };
  }
  return { legacyId: id };
}

export async function resolveWorkFrontPg(
  prisma: PrismaService,
  idOuLegacy: string,
) {
  return prisma.workFront.findFirst({
    where: workFrontWhere(idOuLegacy),
    include: {
      company: { select: { id: true, legacyId: true } },
    },
  });
}
