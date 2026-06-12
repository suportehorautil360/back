import {
  CallHandler,
  ConflictException,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import type { Request } from 'express';
import { from, lastValueFrom, Observable } from 'rxjs';
import { FirebaseService } from '../config/firebase.service';

/**
 * Idempotência para escritas do operador offline (spec offline-outbox).
 * O front gera um uuid por registro e o manda no header `Idempotency-Key`;
 * reenvio (retry do outbox) com a mesma chave devolve a resposta gravada em
 * vez de duplicar. A "reserva" da chave usa `create()` (falha se já existe),
 * o que fecha a corrida entre dois reenvios simultâneos.
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(private firebase: FirebaseService) {}

  private doc(chave: string) {
    return this.firebase
      .getFirestore()
      .collection('idempotencyKeys')
      .doc(chave);
  }

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = ctx.switchToHttp().getRequest<Request>();
    const chave = req.headers['idempotency-key'];
    if (!chave || typeof chave !== 'string') return next.handle();
    return from(this.executar(chave, next));
  }

  private async executar(chave: string, next: CallHandler): Promise<unknown> {
    const ref = this.doc(chave);
    try {
      await ref.create({
        status: 'processando',
        criadoEm: new Date().toISOString(),
        // Campo para política de TTL do Firestore (limpeza de chaves velhas).
        expiraEm: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      });
    } catch {
      const snap = await ref.get();
      const dados = snap.data() as
        | { status?: string; resposta?: unknown }
        | undefined;
      if (dados?.status === 'concluido') return dados.resposta;
      throw new ConflictException(
        'Requisição idêntica em processamento — tente novamente.',
      );
    }
    try {
      const resposta = await lastValueFrom(next.handle());
      await ref.set(
        { status: 'concluido', resposta: resposta ?? null },
        { merge: true },
      );
      return resposta;
    } catch (e) {
      // Libera a chave: o cliente pode tentar de novo e aí executar de fato.
      await ref.delete().catch(() => undefined);
      throw e;
    }
  }
}
