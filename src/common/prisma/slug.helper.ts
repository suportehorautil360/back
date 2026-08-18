export function slugifyNome(input: string, fallback: string): string {
  const base = input
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
  return base || fallback;
}

export async function slugUnicoEmpresa(
  prisma: { company: { findUnique: (args: { where: { slug: string } }) => Promise<unknown | null> } },
  nome: string,
  fallbackId: string,
): Promise<string> {
  let slug = slugifyNome(nome, fallbackId.slice(0, 8));
  if (await prisma.company.findUnique({ where: { slug } })) {
    slug = `${slug}-${fallbackId.slice(0, 6)}`;
  }
  return slug;
}
