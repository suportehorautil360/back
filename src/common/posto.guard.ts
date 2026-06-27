import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';

interface TokenPayload {
  sub?: string;
  vinculo?: string;
  prefeituraId?: string;
  postoId?: string | null;
}

/**
 * Isolamento por posto nos endpoints do portal posto-web. Exige JWT válido cujo
 * `postoId` bata com o parâmetro da rota — operador de um posto não lista dados
 * de outro.
 */
@Injectable()
export class PostoGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<Request>();
    const header = req.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (!token) {
      throw new UnauthorizedException('Autenticação necessária.');
    }

    const secret = this.config.get<string>('JWT_SECRET');
    if (!secret) {
      throw new UnauthorizedException('JWT não configurado no servidor.');
    }

    let payload: TokenPayload;
    try {
      payload = await this.jwt.verifyAsync<TokenPayload>(token, { secret });
    } catch {
      throw new UnauthorizedException('Sessão inválida ou expirada.');
    }

    const params = req.params as Record<string, string>;
    const postoParam = params.postoId?.trim();
    const tokenPosto =
      typeof payload.postoId === 'string' ? payload.postoId.trim() : '';

    if (postoParam && tokenPosto && tokenPosto !== postoParam) {
      throw new ForbiddenException('Acesso a outro posto não permitido.');
    }

    return true;
  }
}
