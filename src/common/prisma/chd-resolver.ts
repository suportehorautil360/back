import type { PrismaService } from '../../prisma/prisma.service';
import { isUuid } from './company-resolver';

export function chdWhere(idOuLegacy: string) {
  const id = idOuLegacy.trim();
  if (!id) return { id: '__invalid__' };
  if (isUuid(id)) {
    return { OR: [{ id }, { legacyId: id }] };
  }
  return { legacyId: id };
}

export async function resolveChecklistDevolucaoPg(
  prisma: PrismaService,
  idOuLegacy: string,
) {
  return prisma.checklistDevolucao.findFirst({
    where: chdWhere(idOuLegacy),
    include: {
      company: { select: { legacyId: true } },
    },
  });
}
