import type { Partner, PartnerPortalUser, Company } from '../../../prisma/generated/client';
import { mapPartnerToOficinaListItem } from '../../../common/prisma/partner-prisma.mapper';
import type { OficinaListItem } from '../../oficinas/oficinas.types';

export type PortalUserWithPartner = PartnerPortalUser & {
  partner:
    | (Partner & {
        company: Pick<Company, 'legacyId'>;
      })
    | null;
};

export function portalUserPublicId(user: Pick<PartnerPortalUser, 'id' | 'legacyId'>): string {
  return user.legacyId?.trim() || user.id;
}

export function portalPartnerLegacyId(
  user: Pick<PartnerPortalUser, 'partnerLegacyId'>,
): string {
  return user.partnerLegacyId?.trim() || '';
}

export function portalPrefeituraLegacyId(user: PortalUserWithPartner): string {
  return user.partner?.company.legacyId?.trim() ?? '';
}

/** Vínculo efetivo: prioriza o tipo atual do parceiro no PG. */
export function resolvePortalVinculo(
  user: Pick<PartnerPortalUser, 'vinculo'> & {
    partner?: Pick<Partner, 'type'> | null;
  },
): 'oficina' | 'posto' {
  const partnerType = user.partner?.type;
  if (partnerType === 'OFICINA') return 'oficina';
  if (partnerType === 'POSTO') return 'posto';
  return user.vinculo === 'posto' ? 'posto' : 'oficina';
}

export function mapPortalUserToOficina(
  user: PortalUserWithPartner,
): OficinaListItem | null {
  if (!user.partner || user.partner.type !== 'OFICINA') {
    return null;
  }

  const prefeituraId = portalPrefeituraLegacyId(user);
  return mapPartnerToOficinaListItem(user.partner, prefeituraId);
}
