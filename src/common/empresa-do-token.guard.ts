import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  Optional,
} from '@nestjs/common';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { Request } from 'express';

import { PrismaService } from '../prisma/prisma.service';

/**
 * De qual empresa é quem está chamando — quando dá para saber, e sem exigir.
 *
 * Existe por causa de uma rota que precisa das duas coisas ao mesmo tempo:
 * `/checklist-definitions` atende o app do operador, e o login por CHASSI não
 * tem credencial nenhuma por desenho — o chassi identifica uma MÁQUINA, não
 * uma pessoa. Exigir token ali derrubaria um fluxo legítimo de campo; ignorar
 * o token de quem TEM entregaria a lista de todo mundo para todo mundo.
 *
 * Então: sem token, `companyIdOpcional` fica nulo e a rota decide o que servir
 * a um anônimo (o catálogo base, e só). Com token válido, a rota sabe a
 * empresa e pode servir o que é dela.
 *
 * NUNCA recusa. Token ausente, expirado, de outro emissor ou de um usuário que
 * sumiu do banco dão todos no mesmo resultado — anônimo. É o oposto do
 * `PainelGuard`, que existe para barrar; este existe para IDENTIFICAR. Um
 * guard que barrasse aqui transformaria "sua sessão venceu" em "esta tela
 * quebrou" no meio do pátio.
 *
 * Duas origens de empresa, porque são dois cadastros diferentes:
 *  - `app_metadata.company_id` no token — é o que a sessão do OPERADOR carrega
 *    (emitida pela edge function do login por CPF);
 *  - `CompanyUser.id = sub` — é o usuário do PAINEL, que não tem
 *    `app_metadata`.
 */
export type RequestComEmpresaOpcional = Request & {
  companyIdOpcional: string | null;
};

export type LeitorDeToken = (
  token: string,
) => Promise<{ sub?: string; companyId?: string }>;

/** Token de DI — só os testes registram, para não verificar assinatura na rede. */
export const LEITOR_DE_TOKEN_EMPRESA = Symbol('LEITOR_DE_TOKEN_EMPRESA');

function leitorSupabase(): LeitorDeToken {
  const jwksUrl = process.env.SUPABASE_JWKS_URL;
  const supabaseUrl = process.env.SUPABASE_URL;
  if (!jwksUrl || !supabaseUrl) {
    // Sem configuração não dá para verificar nada — e como este guard não
    // barra, o resultado é todo mundo anônimo, que é o comportamento seguro.
    return () => Promise.resolve({});
  }
  const jwks = createRemoteJWKSet(new URL(jwksUrl));
  return async (token: string) => {
    const { payload } = await jwtVerify(token, jwks, {
      issuer: `${supabaseUrl.replace(/\/$/, '')}/auth/v1`,
      audience: 'authenticated',
    });
    const meta = payload.app_metadata as { company_id?: unknown } | undefined;
    return {
      sub: typeof payload.sub === 'string' ? payload.sub : undefined,
      companyId:
        typeof meta?.company_id === 'string' ? meta.company_id : undefined,
    };
  };
}

@Injectable()
export class EmpresaDoTokenGuard implements CanActivate {
  private readonly ler: LeitorDeToken;

  constructor(
    private readonly prisma: PrismaService,
    @Optional()
    @Inject(LEITOR_DE_TOKEN_EMPRESA)
    leitor?: LeitorDeToken,
  ) {
    this.ler = leitor ?? leitorSupabase();
  }

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<Request>();
    (req as RequestComEmpresaOpcional).companyIdOpcional =
      await this.resolver(req);
    return true;
  }

  private async resolver(req: Request): Promise<string | null> {
    const header = req.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (!token) return null;

    try {
      const { sub, companyId } = await this.ler(token);
      // O do operador vem no próprio token e não custa consulta.
      if (companyId) return companyId;
      if (!sub) return null;

      const usuario = await this.prisma.companyUser.findUnique({
        where: { id: sub },
        select: { companyId: true, status: true },
      });
      // Acesso desativado é o mesmo que anônimo: vê o catálogo base, não o da
      // empresa de onde saiu.
      return usuario && usuario.status === 'ACTIVE' ? usuario.companyId : null;
    } catch {
      return null;
    }
  }
}
