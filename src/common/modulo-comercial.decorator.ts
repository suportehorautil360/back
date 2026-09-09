import { SetMetadata } from '@nestjs/common';

/**
 * Chave de metadata lida pelo `PainelGuard` (`ctx.getHandler()`/`ctx.getClass()`
 * via `Reflect.getMetadata`, o mesmo mecanismo por trás de `Reflector` do
 * Nest) pra saber qual feature comercial e qual grupo de acesso (cargo) uma
 * rota do painel exige.
 *
 * Ausência do decorator numa rota preserva o comportamento antigo do guard:
 * só os três checks de `status`, sem gate de feature/cargo. É assim que o
 * `PainelGuard` continua genérico — o próximo módulo que quiser o gate só
 * decora o controller, sem precisar de uma subclasse do guard nem de mudar a
 * assinatura dele (metadata não depende de injeção de dependência).
 */
export const MODULO_COMERCIAL_KEY = Symbol('MODULO_COMERCIAL_KEY');

export interface ModuloComercialMeta {
  /** `Feature.key` em `company_features` — ex.: `'mecanica'`. */
  featureKey: string;
  /**
   * `AccessGroup.key` em `role_access_groups`/`company_role_access_groups`.
   *
   * SEM default: em `horautil/lib/company/access-groups.ts`,
   * `ACCESS_GROUP_TO_MENU` mapeia `gestao_frota` → feature `frota` e
   * `pessoas_rh` → feature `pessoas` — as chaves divergem na maioria dos
   * módulos, `mecanica` é a exceção que coincide. Um default `= featureKey`
   * faria o próximo módulo esquecido virar um `AccessGroup` inexistente
   * consultado em silêncio: `cargoLiberaGrupo` não acha a chave, nega pra
   * todo mundo, e nada loga erro. Mapeamento de autorização não pode ter
   * default implícito — por isso este é obrigatório.
   */
  accessGroupKey: string;
}

/**
 * Decora um controller (ou uma rota específica) do painel com a chave da
 * feature comercial e do grupo de acesso que o `PainelGuard` deve exigir.
 *
 * @param featureKey Chave da feature em `company_features` (catálogo vive em
 *   `horautil/lib/features/catalog.ts`, não duplicado aqui).
 * @param accessGroupKey Chave do `AccessGroup` do cargo. Obrigatório: veja o
 *   comentário em `ModuloComercialMeta.accessGroupKey` sobre por que não tem
 *   default.
 */
export function ModuloComercial(featureKey: string, accessGroupKey: string) {
  const meta: ModuloComercialMeta = { featureKey, accessGroupKey };
  return SetMetadata(MODULO_COMERCIAL_KEY, meta);
}
