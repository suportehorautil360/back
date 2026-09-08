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

/** Quem está pedindo, resolvido do token. Nunca vem do corpo da requisição. */
export interface PainelPayload {
  companyUserId: string;
  companyId: string;
  /** `null` quando o usuário do painel não é funcionário (gestor puro). */
  operatorId: string | null;
  companyRoleId: string | null;
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
        company: { select: { status: true } },
        operator: { select: { id: true, status: true, companyRoleId: true } },
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

    (req as RequestComPainel).painel = {
      companyUserId: usuario.id,
      companyId: usuario.companyId,
      operatorId: usuario.operator?.id ?? null,
      companyRoleId: usuario.operator?.companyRoleId ?? null,
    };
    return true;
  }
}
