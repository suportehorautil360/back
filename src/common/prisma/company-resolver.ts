import type { PrismaService } from '../../prisma/prisma.service';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

/** Resolve empresa por UUID Postgres ou legacyId Firestore (docId). */
export async function resolverEmpresa(
  prisma: PrismaService,
  idOuLegacy: string,
  select?: { id: true; legacyId?: true; name?: true; slug?: true },
) {
  if (!idOuLegacy) return null;

  const baseSelect = select ?? { id: true, legacyId: true };

  if (isUuid(idOuLegacy)) {
    const porId = await prisma.company.findUnique({
      where: { id: idOuLegacy },
      select: baseSelect,
    });
    if (porId) return porId;
  }

  return prisma.company.findUnique({
    where: { legacyId: idOuLegacy },
    select: baseSelect,
  });
}

export async function resolverCompanyId(
  prisma: PrismaService,
  prefeituraId: string,
): Promise<string | null> {
  const company = await resolverEmpresa(prisma, prefeituraId, { id: true });
  return company?.id ?? null;
}

/** Where seguro: legacyId não passa por coluna UUID (evita P2007 com "tl-ms"). */
export function companyWhere(idOuLegacy: string) {
  if (isUuid(idOuLegacy)) {
    return { OR: [{ id: idOuLegacy }, { legacyId: idOuLegacy }] };
  }
  return { legacyId: idOuLegacy };
}
