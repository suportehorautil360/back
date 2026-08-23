import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';

export interface JwtPayload {
  /** `partner_portal_users.legacy_id` ou UUID do Postgres. */
  sub: string;
  oficinaId?: string;
  postoId?: string;
  prefeituraId: string;
  perfil?: string;
  vinculo?: string;
  credLevel?: string;
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
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

    try {
      const payload = await this.jwt.verifyAsync<JwtPayload>(token, {
        secret,
      });
      (req as Request & { jwtPayload: JwtPayload }).jwtPayload = payload;
      return true;
    } catch {
      throw new UnauthorizedException('Sessão inválida ou expirada.');
    }
  }
}
