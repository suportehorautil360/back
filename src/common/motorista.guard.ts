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
  tipo?: string;
  prefeituraId?: string;
  funcionarioId?: string;
}

/**
 * Isolamento por empresa/condutor nos endpoints do app motorista. Exige JWT de
 * login do funcionário cujo `prefeituraId`/`funcionarioId` batam com o body.
 * `tipo:admin` passa livre (cross-tenant).
 */
@Injectable()
export class MotoristaGuard implements CanActivate {
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

    if (payload.tipo === 'admin') return true;

    const body = req.body as Record<string, unknown>;
    const prefeituraId =
      typeof body.prefeituraId === 'string' ? body.prefeituraId.trim() : '';
    const funcionarioId =
      typeof body.funcionarioId === 'string' ? body.funcionarioId.trim() : '';

    if (!prefeituraId || !funcionarioId) {
      throw new ForbiddenException('Credenciais do condutor incompletas.');
    }

    if (payload.prefeituraId !== prefeituraId) {
      throw new ForbiddenException('Acesso a outra empresa não permitido.');
    }
    if (payload.funcionarioId !== funcionarioId) {
      throw new ForbiddenException('Acesso a outro condutor não permitido.');
    }

    return true;
  }
}
