import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';

/**
 * Protege rotas administrativas com o header `x-admin-secret`, comparado ao env
 * `ADMIN_SECRET`. Se a env não estiver definida (dev local), libera.
 */
@Injectable()
export class AdminSecretGuard implements CanActivate {
  constructor(private config: ConfigService) {}

  canActivate(ctx: ExecutionContext): boolean {
    const segredo = this.config.get<string>('ADMIN_SECRET');
    if (!segredo) return true;
    const req = ctx.switchToHttp().getRequest<Request>();
    if (req.headers['x-admin-secret'] !== segredo) {
      throw new UnauthorizedException('Acesso administrativo negado.');
    }
    return true;
  }
}
