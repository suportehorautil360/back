import type { PrismaService } from '../../prisma/prisma.service';
import { isUuid } from './company-resolver';

export function chegadaWhere(idOuLegacy: string) {
  const id = idOuLegacy.trim();
  if (!id) return { id: '__invalid__' };
  if (isUuid(id)) {
    return { OR: [{ id }, { legacyId: id }] };
  }
  return { legacyId: id };
}

export async function resolveChecklistChegadaPg(
  prisma: PrismaService,
  idOuLegacy: string,
) {
  return prisma.checklistChegada.findFirst({
    where: chegadaWhere(idOuLegacy),
    include: {
      company: { select: { legacyId: true } },
    },
  });
}
