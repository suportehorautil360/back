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
   * Default = `featureKey`: coincide para mecânica (ambos `'mecanica'`), mas
   * NÃO é regra geral — em `horautil/lib/company/access-groups.ts`,
   * `ACCESS_GROUP_TO_MENU` mapeia `gestao_frota` → feature `frota` e
   * `pessoas_rh` → feature `pessoas`. Quando o próximo módulo divergir assim,
   * passe o segundo argumento.
   */
  accessGroupKey: string;
}

/**
 * Decora um controller (ou uma rota específica) do painel com a chave da
 * feature comercial e do grupo de acesso que o `PainelGuard` deve exigir.
 *
 * @param featureKey Chave da feature em `company_features` (catálogo vive em
 *   `horautil/lib/features/catalog.ts`, não duplicado aqui).
 * @param accessGroupKey Chave do `AccessGroup` do cargo, quando diferente de
 *   `featureKey`.
 */
export function ModuloComercial(
  featureKey: string,
  accessGroupKey = featureKey,
) {
  const meta: ModuloComercialMeta = { featureKey, accessGroupKey };
  return SetMetadata(MODULO_COMERCIAL_KEY, meta);
}
