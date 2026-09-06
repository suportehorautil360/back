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

/** Token emitido por `funcionarios.service.ts` → `emitirJwtFuncionario`. */
export interface OperadorPayload {
  sub: string;
  tipo: string;
  cargo?: string;
  prefeituraId: string;
  funcionarioId: string;
}

export type RequestComOperador = Request & { operador: OperadorPayload };

/**
 * Autentica o operador do app de campo.
 *
 * Não basta a assinatura ser válida: o token do gestor do portal é assinado
 * com o MESMO `JWT_SECRET`. Sem exigir `tipo === 'operador'` e
 * `funcionarioId`, um gestor leria por estas rotas o ponto — com selfie e
 * CPF — de qualquer pessoa da empresa.
 */
@Injectable()
export class OperadorGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<Request>();
    const header = req.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (!token) throw new UnauthorizedException('Autenticação necessária.');

    const secret = this.config.get<string>('JWT_SECRET');
    if (!secret) throw new UnauthorizedException('JWT não configurado no servidor.');

    let payload: OperadorPayload;
    try {
      payload = await this.jwt.verifyAsync<OperadorPayload>(token, { secret });
    } catch {
      throw new UnauthorizedException('Sessão inválida ou expirada.');
    }

    if (payload.tipo !== 'operador' || !payload.funcionarioId) {
      throw new ForbiddenException('Este token não é de operador.');
    }

    (req as RequestComOperador).operador = payload;
    return true;
  }
}
