import { createHash } from 'node:crypto';
import type { PartnerPortalUser } from '../../../prisma/generated/client';

/** SHA-256 sem salt — mesmo algoritmo do login operacional no front. */
export function hashSenhaOperacional(senha: string): string {
  return createHash('sha256').update(senha, 'utf8').digest('hex');
}

export interface ParceiroLoginRow {
  id: string;
  nome: string;
  usuario: string;
  perfil: string;
  vinculo: 'posto' | 'oficina';
  prefeituraId: string;
  postoId?: string;
  officinaId?: string;
  createdAt: string;
}

export function mapParceiroLoginDoc(
  docId: string,
  data: Record<string, unknown>,
): ParceiroLoginRow | null {
  const vinculo = data.vinculo === 'posto' || data.vinculo === 'oficina'
    ? data.vinculo
    : data.type === 'posto' || data.type === 'oficina'
      ? data.type
      : null;
  if (!vinculo) return null;

  return {
    id: docId,
    nome: typeof data.nome === 'string' ? data.nome.trim() : '',
    usuario: typeof data.usuario === 'string' ? data.usuario.trim() : '',
    perfil: typeof data.perfil === 'string' ? data.perfil : 'gestor',
    vinculo,
    prefeituraId:
      typeof data.prefeituraId === 'string' ? data.prefeituraId.trim() : '',
    ...(typeof data.postoId === 'string' && data.postoId.trim()
      ? { postoId: data.postoId.trim() }
      : {}),
    ...(typeof data.officinaId === 'string' && data.officinaId.trim()
      ? { officinaId: data.officinaId.trim() }
      : {}),
    createdAt:
      typeof data.createdAt === 'string'
        ? data.createdAt
        : new Date().toISOString(),
  };
}

export function mapPartnerPortalUserToParceiroLoginRow(
  row: PartnerPortalUser,
  prefeituraLegacyId: string,
): ParceiroLoginRow {
  const vinculo = row.vinculo === 'posto' ? 'posto' : 'oficina';
  const partnerLegacyId = row.partnerLegacyId?.trim() ?? '';

  return {
    id: row.legacyId?.trim() || row.id,
    nome: row.nome,
    usuario: row.usuario,
    perfil: row.perfil,
    vinculo,
    prefeituraId: prefeituraLegacyId,
    ...(vinculo === 'posto' && partnerLegacyId
      ? { postoId: partnerLegacyId }
      : {}),
    ...(vinculo === 'oficina' && partnerLegacyId
      ? { officinaId: partnerLegacyId }
      : {}),
    createdAt: row.createdAt.toISOString(),
  };
}
