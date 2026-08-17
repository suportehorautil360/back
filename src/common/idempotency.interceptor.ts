import {
  BadRequestException,
  CallHandler,
  ConflictException,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import type { Request } from 'express';
import { from, lastValueFrom, Observable } from 'rxjs';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '../prisma/generated/client';

/** Formato aceito para a chave (uuid do outbox cabe aqui). */
const CHAVE_VALIDA = /^[A-Za-z0-9_-]{8,128}$/;

/** Reserva "processando" mais velha que isso é de processo morto: pode assumir. */
const RESERVA_PRESA_MS = 10 * 60 * 1000;

/** Política de TTL para limpeza periódica de chaves velhas. */
const TTL_MS = 30 * 24 * 60 * 60 * 1000;

type Reserva =
  | { tipo: 'executar' }
  | { tipo: 'concluido'; resposta: unknown; rota?: string | null }
  | { tipo: 'processando' };

/**
 * Idempotência para escritas do operador offline (spec offline-outbox).
 * O front gera um uuid por registro e o manda no header `Idempotency-Key`;
 * reenvio (retry do outbox) com a mesma chave devolve a resposta gravada em
 * vez de duplicar. A reserva da chave roda numa transação Postgres.
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  private readonly logger = new Logger(IdempotencyInterceptor.name);

  constructor(private readonly prisma: PrismaService) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = ctx.switchToHttp().getRequest<Request>();
    const chave = req.headers['idempotency-key'];
    if (!chave || typeof chave !== 'string') return next.handle();
    const rota = `${req.method} ${req.path}`;
    return from(this.executar(chave, rota, next));
  }

  private async executar(
    chave: string,
    rota: string,
    next: CallHandler,
  ): Promise<unknown> {
    if (!CHAVE_VALIDA.test(chave)) {
      throw new BadRequestException('Idempotency-Key inválida.');
    }

    const reserva = await this.prisma.$transaction(async (tx): Promise<Reserva> => {
      const existing = await tx.idempotencyKey.findUnique({ where: { key: chave } });
      const novaReserva = {
        status: 'processando',
        rota,
        expiresAt: new Date(Date.now() + TTL_MS),
      };

      if (!existing) {
        await tx.idempotencyKey.create({
          data: { key: chave, ...novaReserva },
        });
        return { tipo: 'executar' };
      }

      if (existing.status === 'concluido') {
        return {
          tipo: 'concluido',
          resposta: existing.resposta ?? null,
          rota: existing.rota,
        };
      }

      const idade = Date.now() - existing.createdAt.getTime();
      if (!(idade < RESERVA_PRESA_MS)) {
        await tx.idempotencyKey.update({
          where: { key: chave },
          data: novaReserva,
        });
        return { tipo: 'executar' };
      }

      return { tipo: 'processando' };
    });

    if (reserva.tipo === 'concluido') {
      if (reserva.rota && reserva.rota !== rota) {
        throw new ConflictException('Idempotency-Key já usada em outra rota.');
      }
      return reserva.resposta;
    }
    if (reserva.tipo === 'processando') {
      throw new ConflictException(
        'Requisição idêntica em processamento — tente novamente.',
      );
    }

    let resposta: unknown;
    try {
      resposta = await lastValueFrom(next.handle());
    } catch (e) {
      await this.prisma.idempotencyKey
        .delete({ where: { key: chave } })
        .catch((erroDelete) => {
          this.logger.warn(
            `Falha ao liberar a chave ${chave} após erro do handler: ${String(erroDelete)}`,
          );
        });
      throw e;
    }

    const enxuta = this.semBinarios(resposta);
    try {
      await this.prisma.idempotencyKey.update({
        where: { key: chave },
        data: {
          status: 'concluido',
          resposta: (enxuta ?? Prisma.JsonNull) as Prisma.InputJsonValue,
        },
      });
    } catch {
      try {
        await this.prisma.idempotencyKey.update({
          where: { key: chave },
          data: { status: 'concluido', resposta: Prisma.JsonNull },
        });
      } catch (erroFallback) {
        this.logger.warn(
          `Falha ao gravar conclusão da chave ${chave}: ${String(erroFallback)}`,
        );
      }
    }
    return resposta;
  }

  /**
   * Cópia da resposta sem os binários pesados (selfie do ponto e anexo da
   * solicitação — base64 enorme + PII).
   */
  private semBinarios(resposta: unknown): unknown {
    if (!resposta || typeof resposta !== 'object') return resposta;
    const data = (resposta as { data?: unknown }).data;
    if (!data || typeof data !== 'object') return resposta;
    const d = data as Record<string, unknown>;
    if (!('photo' in d) && !('anexoDataUrl' in d)) return resposta;
    const limpo: Record<string, unknown> = { ...d };
    if ('photo' in limpo) limpo.photo = null;
    if ('anexoDataUrl' in limpo) limpo.anexoDataUrl = null;
    return { ...resposta, data: limpo };
  }
}
