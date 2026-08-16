import type { Partner } from '../../prisma/generated/client';

/** Compat com lista Firestore `postos`. */
export function mapPartnerPostoToApi(
  partner: Partner,
  prefeituraId: string,
) {
  const legacyId = partner.legacyId ?? partner.id;
  return {
    id: legacyId,
    prefeituraId,
    tipoParceiro: 'posto',
    cnpj: partner.cnpj ?? '',
    telefonePrincipal: partner.telefonePrincipal ?? '',
    razaoSocial: partner.razaoSocial,
    nomeFantasia: partner.nomeFantasia ?? partner.razaoSocial,
    emailComercial: partner.emailComercial ?? '',
    cidadeUf: partner.cidadeUf ?? '',
    endereco: partner.endereco ?? '',
    precoPorLitro: partner.precoPorLitro ?? null,
    createdAt: partner.createdAt.toISOString(),
  };
}
