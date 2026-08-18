import type { PrismaService } from '../../prisma/prisma.service';
import { mapOficinaCredenciadaDoc } from '../../modules/os/helpers/oficinas-credenciadas.helper';
import type { OficinaAtiva } from '../../modules/os/os.types';

function listaTexto(valor: unknown): string[] {
  if (!Array.isArray(valor)) return [];
  return valor.filter((v): v is string => typeof v === 'string' && v.trim() !== '');
}

function partnerToOficinaDoc(
  legacyId: string,
  row: {
    companyId: string;
    razaoSocial: string;
    nomeFantasia: string | null;
    especialidade: string | null;
    linhasAtuacao: unknown;
    segmentosAtuacao: unknown;
    categoriasServico: unknown;
    status: string;
    ativo: boolean;
  },
  prefeituraLegacyId: string,
): Record<string, unknown> {
  return {
    prefeituraId: prefeituraLegacyId,
    status: row.ativo ? 'Ativa' : row.status || 'Inativa',
    nome: row.nomeFantasia || row.razaoSocial,
    nomeFantasia: row.nomeFantasia,
    razaoSocial: row.razaoSocial,
    especialidade: row.especialidade,
    linhasAtuacao: listaTexto(row.linhasAtuacao),
    segmentosAtuacao: listaTexto(row.segmentosAtuacao),
    categoriasServico: listaTexto(row.categoriasServico),
    id: legacyId,
  };
}

export function partnerPublicId(row: {
  id: string;
  legacyId: string | null;
}): string {
  return row.legacyId ?? row.id;
}

/** Oficinas credenciadas ativas da empresa (Postgres `partners`). */
export async function listarOficinasAtivasPg(
  prisma: PrismaService,
  companyId: string,
  prefeituraLegacyId: string,
): Promise<OficinaAtiva[]> {
  const rows = await prisma.partner.findMany({
    where: {
      companyId,
      type: 'OFICINA',
      ativo: true,
    },
  });

  return rows
    .map((row) =>
      mapOficinaCredenciadaDoc(
        partnerPublicId(row),
        partnerToOficinaDoc(partnerPublicId(row), row, prefeituraLegacyId),
      ),
    )
    .filter((o): o is OficinaAtiva => o !== null);
}

export async function findPartnerOficinaPg(
  prisma: PrismaService,
  oficinaId: string,
): Promise<{ id: string; nome: string } | null> {
  const id = oficinaId.trim();
  if (!id) return null;

  const row = await prisma.partner.findFirst({
    where: {
      type: 'OFICINA',
      OR: [{ id }, { legacyId: id }],
    },
    select: {
      id: true,
      legacyId: true,
      nomeFantasia: true,
      razaoSocial: true,
    },
  });

  if (!row) return null;

  return {
    id: partnerPublicId(row),
    nome: row.nomeFantasia?.trim() || row.razaoSocial.trim() || id,
  };
}
