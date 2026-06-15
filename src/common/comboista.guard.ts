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
 * Isolamento por empresa nos endpoints do comboista. Exige um JWT válido (login
 * do funcionário) cujo `prefeituraId`/`funcionarioId` batam com os parâmetros da
 * rota — assim um token de uma empresa não lista comboios de outra. `tipo:admin`
 * passa livre (cross-tenant). Aplicar só nos endpoints que o PWA do comboista
 * chama (ele já envia o token); os endpoints compartilhados com o admin/gestor
 * ficam de fora até a auth do 360-repo existir.
 */
@Injectable()
export class ComboistaGuard implements CanActivate {
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

    const params = req.params as Record<string, string>;
    if (params.prefeituraId && payload.prefeituraId !== params.prefeituraId) {
      throw new ForbiddenException('Acesso a outra empresa não permitido.');
    }
    if (params.motoristaId && payload.funcionarioId !== params.motoristaId) {
      throw new ForbiddenException('Acesso a outro condutor não permitido.');
    }
    return true;
  }
}
