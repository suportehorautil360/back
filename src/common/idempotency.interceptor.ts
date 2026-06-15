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
import { FirebaseService } from '../config/firebase.service';

/** Formato aceito para a chave (uuid do outbox cabe aqui). */
const CHAVE_VALIDA = /^[A-Za-z0-9_-]{8,128}$/;

/** Reserva "processando" mais velha que isso é de processo morto: pode assumir. */
const RESERVA_PRESA_MS = 10 * 60 * 1000;

/** Campo para política de TTL do Firestore (limpeza de chaves velhas). */
const TTL_MS = 30 * 24 * 60 * 60 * 1000;

interface DocChave {
  status?: string;
  criadoEm?: string;
  resposta?: unknown;
  rota?: string;
}

type Reserva =
  | { tipo: 'executar' }
  | { tipo: 'concluido'; resposta: unknown; rota?: string }
  | { tipo: 'processando' };

/**
 * Idempotência para escritas do operador offline (spec offline-outbox).
 * O front gera um uuid por registro e o manda no header `Idempotency-Key`;
 * reenvio (retry do outbox) com a mesma chave devolve a resposta gravada em
 * vez de duplicar. A reserva da chave roda numa transação do Firestore, que
 * fecha a corrida entre dois reenvios simultâneos sem conflar erro transitório
 * com chave já existente.
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  private readonly logger = new Logger(IdempotencyInterceptor.name);

  constructor(private firebase: FirebaseService) {}

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
    const db = this.firebase.getFirestore();
    const ref = db.collection('idempotencyKeys').doc(chave);
    const reserva = await db.runTransaction(async (tx): Promise<Reserva> => {
      const snap = await tx.get(ref);
      const dados = snap.data() as DocChave | undefined;
      const novaReserva = {
        status: 'processando',
        criadoEm: new Date().toISOString(),
        expiraEm: new Date(Date.now() + TTL_MS),
        rota,
      };
      if (!snap.exists || !dados) {
        tx.set(ref, novaReserva);
        return { tipo: 'executar' };
      }
      if (dados.status === 'concluido') {
        return {
          tipo: 'concluido',
          resposta: dados.resposta ?? null,
          rota: dados.rota,
        };
      }
      const idade = Date.now() - Date.parse(dados.criadoEm ?? '');
      if (!(idade < RESERVA_PRESA_MS)) {
        // Reserva presa (processo caiu antes de concluir/liberar): assume.
        tx.set(ref, novaReserva, { merge: true });
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
      // `handle()` é Observable<any> no Nest; tratamos como unknown por segurança.
      resposta = await lastValueFrom(next.handle());
    } catch (e) {
      // Libera a chave: o cliente pode tentar de novo e aí executar de fato.
      await ref.delete().catch((erroDelete) => {
        this.logger.warn(
          `Falha ao liberar a chave ${chave} após erro do handler: ${String(erroDelete)}`,
        );
      });
      throw e;
    }

    // Daqui em diante a batida já foi gravada: nunca apagar a chave nem
    // propagar erro de persistência — senão um retry duplica o registro.
    const enxuta = this.semFoto(resposta);
    try {
      await ref.set(
        { status: 'concluido', resposta: enxuta ?? null },
        { merge: true },
      );
    } catch {
      try {
        await ref.set({ status: 'concluido', resposta: null }, { merge: true });
      } catch (erroFallback) {
        this.logger.warn(
          `Falha ao gravar conclusão da chave ${chave}: ${String(erroFallback)}`,
        );
      }
    }
    return resposta;
  }

  /**
   * Cópia da resposta sem a selfie (base64 enorme + PII). O retry do outbox
   * descarta o corpo, então o replay não precisa da foto.
   */
  private semFoto(resposta: unknown): unknown {
    if (!resposta || typeof resposta !== 'object') return resposta;
    const data = (resposta as { data?: unknown }).data;
    if (!data || typeof data !== 'object' || !('photo' in data)) {
      return resposta;
    }
    return { ...resposta, data: { ...data, photo: null } };
  }
}
