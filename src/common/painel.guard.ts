import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  Optional,
  UnauthorizedException,
} from '@nestjs/common';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { Request } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import {
  MODULO_COMERCIAL_KEY,
  type ModuloComercialMeta,
} from './modulo-comercial.decorator';

/** Quem está pedindo, resolvido do token. Nunca vem do corpo da requisição. */
export interface PainelPayload {
  companyUserId: string;
  companyId: string;
  /** `null` quando o usuário do painel não é funcionário (gestor puro). */
  operatorId: string | null;
  companyRoleId: string | null;
  /**
   * Nome para EXIBIÇÃO — nunca o UUID de `companyUserId`. Prioriza
   * `Operator.nome` (o nome que o resto do produto já mostra para o
   * funcionário) e cai para `CompanyUser.name` quando ele não é funcionário.
   */
  nomeExibicao: string;
}

export type RequestComPainel = Request & { painel: PainelPayload };

/** Extraído para o teste poder injetar um verificador falso. */
export type VerificadorDeToken = (token: string) => Promise<{ sub: string }>;

/**
 * Token de DI do verificador. Ninguém registra provider pra ele em produção —
 * o construtor cai no fallback `verificadorSupabase()` — só os testes o usam,
 * pra trocar a verificação de assinatura por um stub sem rede.
 */
export const VERIFICADOR_DE_TOKEN_PAINEL = Symbol('VERIFICADOR_DE_TOKEN_PAINEL');

function verificadorSupabase(): VerificadorDeToken {
  const jwksUrl = process.env.SUPABASE_JWKS_URL;
  const supabaseUrl = process.env.SUPABASE_URL;
  if (!jwksUrl || !supabaseUrl) {
    throw new Error(
      'SUPABASE_JWKS_URL e SUPABASE_URL são obrigatórias para o painel.',
    );
  }
  const jwks = createRemoteJWKSet(new URL(jwksUrl));
  return async (token: string) => {
    const { payload } = await jwtVerify(token, jwks, {
      issuer: `${supabaseUrl.replace(/\/$/, '')}/auth/v1`,
      audience: 'authenticated',
    });
    if (typeof payload.sub !== 'string' || !payload.sub) {
      throw new Error('token sem sub');
    }
    return { sub: payload.sub };
  };
}

/**
 * Autentica o usuário do PAINEL usando o token do Supabase.
 *
 * `CompanyUser.id` é o `auth.users.id` do Supabase, então o `sub` do token já
 * é a chave — não há segundo cadastro nem segunda senha, e o app do mecânico
 * (RN + Expo) vai autenticar do mesmo jeito.
 *
 * Ao contrário dos outros guards daqui, este NÃO usa `JWT_SECRET`: o token é
 * assinado pelo Supabase. Um token emitido pelo back nunca passa neste guard,
 * e é justamente por isso que ele não precisa discriminar por claim como o
 * `OperadorGuard` precisa.
 *
 * Repete os checks de `status` que o painel já faz em `getCompanyAccess`. A
 * duplicação é consciente: o back é a autoridade e não pode confiar no cliente.
 *
 * Além do `status`, o guard também é a autoridade do gate COMERCIAL (feature
 * contratada) e do gate de CARGO (grupo de acesso) — antes só existiam no
 * painel Next (`requireCompanyModule`), então qualquer `CompanyUser` ativo
 * chamava a API direto com o token do Supabase e via as OS internas mesmo
 * sem contratar o módulo ou com cargo que não libera. Essas duas checagens só
 * rodam quando a rota carrega `@ModuloComercial(...)` (ver
 * `modulo-comercial.decorator.ts`): sem o decorator, o comportamento é o de
 * sempre — só os três `status` abaixo. É assim que o guard segue genérico e
 * reutilizável por qualquer módulo futuro sem precisar de subclasse nem de
 * mudar esta assinatura.
 *
 * O segundo parâmetro do construtor é injetado via token opcional
 * (`@Optional() @Inject`) em vez de receber `VerificadorDeToken` puro: esse
 * tipo é um alias de função, o TypeScript reflete `Function` em
 * design:paramtypes, e o Nest tentaria resolver um provider pra `Function`
 * (que não existe) e falharia ao subir a aplicação. Com o token explícito e
 * `@Optional()`, a ausência de provider (o caso normal em produção) resolve
 * como `undefined` sem quebrar o boot, e o construtor cai no fallback real.
 */
@Injectable()
export class PainelGuard implements CanActivate {
  private readonly verificar: VerificadorDeToken;

  constructor(
    private readonly prisma: PrismaService,
    @Optional()
    @Inject(VERIFICADOR_DE_TOKEN_PAINEL)
    verificador?: VerificadorDeToken,
  ) {
    this.verificar = verificador ?? verificadorSupabase();
  }

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<Request>();
    const header = req.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (!token) throw new UnauthorizedException('Autenticação necessária.');

    let sub: string;
    try {
      ({ sub } = await this.verificar(token));
    } catch {
      throw new UnauthorizedException('Sessão inválida ou expirada.');
    }

    const usuario = await this.prisma.companyUser.findUnique({
      where: { id: sub },
      select: {
        id: true,
        companyId: true,
        status: true,
        name: true,
        role: true,
        company: { select: { status: true } },
        operator: {
          select: { id: true, status: true, companyRoleId: true, nome: true },
        },
      },
    });

    if (!usuario) {
      throw new ForbiddenException('Usuário sem vínculo com empresa.');
    }
    if (usuario.status !== 'ACTIVE' || usuario.company.status !== 'ACTIVE') {
      throw new ForbiddenException('Acesso desativado.');
    }
    if (usuario.operator && usuario.operator.status !== 'ativo') {
      throw new ForbiddenException('Funcionário inativo.');
    }

    const modulo: ModuloComercialMeta | undefined =
      Reflect.getMetadata(MODULO_COMERCIAL_KEY, ctx.getHandler()) ??
      Reflect.getMetadata(MODULO_COMERCIAL_KEY, ctx.getClass());
    if (modulo) {
      await this.autorizarModuloComercial(usuario, modulo);
    }

    (req as RequestComPainel).painel = {
      companyUserId: usuario.id,
      companyId: usuario.companyId,
      operatorId: usuario.operator?.id ?? null,
      companyRoleId: usuario.operator?.companyRoleId ?? null,
      nomeExibicao: usuario.operator?.nome ?? usuario.name,
    };
    return true;
  }

  /**
   * Gate comercial + gate de cargo de uma rota decorada com `@ModuloComercial`.
   * Lança `ForbiddenException` em qualquer uma das duas negativas — o
   * chamador (`canActivate`) não precisa saber qual das duas barrou.
   */
  private async autorizarModuloComercial(
    usuario: {
      companyId: string;
      role: string;
      operator: { companyRoleId: string | null } | null;
    },
    modulo: ModuloComercialMeta,
  ): Promise<void> {
    /**
     * Regra, decidida pelo dono do produto: a feature está ligada SE E
     * SOMENTE SE existir linha em `company_features` para (empresa, feature)
     * com `enabled = true`. Ausência de linha = DESLIGADO.
     *
     * De propósito NÃO consultamos o default do catálogo
     * (`horautil/lib/features/catalog.ts`, TypeScript, vive no painel) pra
     * decidir esse caso — duplicar os defaults aqui criaria duas fontes de
     * verdade que divergem em silêncio. A regra acima é exata para os
     * módulos gateados por este guard porque eles nascem opt-in
     * (`default: false` no catálogo, caso de `mecanica`). Se algum dia este
     * guard passar a proteger um módulo com default `true` no catálogo, "sem
     * linha = desligado" deixa de valer para ELE — não "conserte" isto
     * assumindo que faltou tratar o default; resolva módulo a módulo.
     */
    const feature = await this.prisma.companyFeature.findFirst({
      where: {
        companyId: usuario.companyId,
        feature: { key: modulo.featureKey },
      },
      select: { enabled: true },
    });
    if (!feature?.enabled) {
      throw new ForbiddenException('Funcionalidade não contratada pela empresa.');
    }

    /**
     * OWNER e ADMIN da empresa não passam pelo gate de CARGO.
     *
     * É a mesma regra que o painel já aplica em
     * `horautil/lib/company/access-groups.ts` (`isFullAccessCompanyRole`), e
     * faltar aqui fazia painel e API discordarem sobre a mesma pessoa: o menu
     * mostrava Mecânica, porque OWNER tem acesso total, e a API recusava,
     * porque OWNER é gestor puro — não tem `Operator` e portanto não tem
     * cargo, e `cargoLiberaGrupo` nega quem não tem cargo. O dono da conta
     * via "não foi possível carregar" em todas as telas do módulo, enquanto o
     * mecânico, que tem cargo, entrava normalmente.
     *
     * Fica DEPOIS do gate comercial de propósito: dono de empresa que não
     * contratou o módulo continua barrado. O que esta exceção dispensa é o
     * cargo operacional, não a licença.
     */
    if (usuario.role === 'OWNER' || usuario.role === 'ADMIN') return;

    const liberado = await this.cargoLiberaGrupo(
      usuario.operator?.companyRoleId ?? null,
      modulo.accessGroupKey,
    );
    if (!liberado) {
      throw new ForbiddenException('Cargo não libera este módulo.');
    }
  }

  /**
   * Mesma ordem de resolução do painel
   * (`horautil/lib/company/role-access.ts` → `getEnabledMenuKeysForCompanyRole`):
   * override por empresa quando existir a linha em `CompanyRoleAccessGroup`,
   * senão a matriz padrão do cargo em `RoleAccessGroup`, casada por `key`
   * (é como o painel semeia a matriz em `ensureCompanyRoleAccessRows`: copia
   * do `Role` global cujo `key` bate com o `CompanyRole.key`).
   *
   * Sem `companyRoleId` (gestor puro, sem `Operator`, ou funcionário sem
   * cargo atribuído) não há o que resolver: nega.
   */
  private async cargoLiberaGrupo(
    companyRoleId: string | null,
    accessGroupKey: string,
  ): Promise<boolean> {
    if (!companyRoleId) return false;

    const override = await this.prisma.companyRoleAccessGroup.findFirst({
      where: { companyRoleId, group: { key: accessGroupKey } },
      select: { enabled: true },
    });
    if (override) return override.enabled;

    const companyRole = await this.prisma.companyRole.findUnique({
      where: { id: companyRoleId },
      select: { key: true },
    });
    if (!companyRole) return false;

    const padrao = await this.prisma.roleAccessGroup.findFirst({
      where: {
        role: { key: companyRole.key },
        group: { key: accessGroupKey },
      },
      select: { enabled: true },
    });
    return padrao?.enabled ?? false;
  }
}
