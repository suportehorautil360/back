import { BadRequestException, ConflictException } from '@nestjs/common';
import type { CallHandler, ExecutionContext } from '@nestjs/common';
import { lastValueFrom, of, throwError } from 'rxjs';
import { IdempotencyInterceptor } from './idempotency.interceptor';
import type { PrismaService } from '../prisma/prisma.service';

const CHAVE = 'chave-abc-123';
const ROTA_PADRAO = { method: 'POST', path: '/time-records' };

function ctxCom(
  headers: Record<string, string>,
  rota: { method: string; path: string } = ROTA_PADRAO,
): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ headers, method: rota.method, path: rota.path }),
    }),
  } as unknown as ExecutionContext;
}

function prismaMock() {
  const store = new Map<
    string,
    {
      key: string;
      status: string;
      rota?: string | null;
      resposta?: unknown;
      createdAt: Date;
      expiresAt?: Date | null;
    }
  >();

  const idempotencyKey = {
    findUnique: jest.fn(async ({ where }: { where: { key: string } }) =>
      store.get(where.key) ?? null,
    ),
    create: jest.fn(
      async ({
        data,
      }: {
        data: {
          key: string;
          status: string;
          rota?: string;
          resposta?: unknown;
          expiresAt?: Date;
        };
      }) => {
        const row = {
          ...data,
          createdAt: new Date(),
        };
        store.set(data.key, row);
        return row;
      },
    ),
    update: jest.fn(
      async ({
        where,
        data,
      }: {
        where: { key: string };
        data: Partial<{
          status: string;
          rota?: string;
          resposta?: unknown;
          expiresAt?: Date;
        }>;
      }) => {
        const atual = store.get(where.key);
        if (!atual) throw new Error('not found');
        const row = { ...atual, ...data };
        store.set(where.key, row);
        return row;
      },
    ),
    delete: jest.fn(async ({ where }: { where: { key: string } }) => {
      store.delete(where.key);
    }),
  };

  const prisma = {
    $transaction: jest.fn(async (fn: (tx: typeof tx) => Promise<unknown>) =>
      fn(tx),
    ),
    idempotencyKey,
  } as unknown as PrismaService;

  const tx = { idempotencyKey };

  return { prisma, idempotencyKey, store };
}

describe('IdempotencyInterceptor', () => {
  it('sem header, passa direto sem tocar o Postgres', async () => {
    const { prisma } = prismaMock();
    const interceptor = new IdempotencyInterceptor(prisma);
    const next: CallHandler = { handle: () => of({ data: 1 }) };
    const r = await lastValueFrom(interceptor.intercept(ctxCom({}), next));
    expect(r).toEqual({ data: 1 });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('primeira chamada reserva na transação, executa o handler e grava a resposta', async () => {
    const { prisma, idempotencyKey } = prismaMock();
    const interceptor = new IdempotencyInterceptor(prisma);
    const next: CallHandler = { handle: () => of({ data: 'novo' }) };
    const r = await lastValueFrom(
      interceptor.intercept(ctxCom({ 'idempotency-key': CHAVE }), next),
    );
    expect(r).toEqual({ data: 'novo' });
    expect(idempotencyKey.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          key: CHAVE,
          status: 'processando',
          rota: 'POST /time-records',
        }),
      }),
    );
    expect(idempotencyKey.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { key: CHAVE },
        data: expect.objectContaining({
          status: 'concluido',
          resposta: { data: 'novo' },
        }),
      }),
    );
  });

  it('chave repetida concluída devolve a resposta gravada sem reexecutar', async () => {
    const { prisma } = prismaMock();
    (prisma.idempotencyKey.findUnique as jest.Mock).mockResolvedValue({
      key: CHAVE,
      status: 'concluido',
      resposta: { data: 'anterior' },
      rota: 'POST /time-records',
      createdAt: new Date(),
    });
    const interceptor = new IdempotencyInterceptor(prisma);
    const handle = jest.fn(() => of({ data: 'nao-deveria' }));
    const r = await lastValueFrom(
      interceptor.intercept(ctxCom({ 'idempotency-key': CHAVE }), { handle }),
    );
    expect(r).toEqual({ data: 'anterior' });
    expect(handle).not.toHaveBeenCalled();
  });

  it('chave repetida ainda em processamento (recente) responde 409', async () => {
    const { prisma } = prismaMock();
    (prisma.idempotencyKey.findUnique as jest.Mock).mockResolvedValue({
      key: CHAVE,
      status: 'processando',
      createdAt: new Date(),
    });
    const interceptor = new IdempotencyInterceptor(prisma);
    await expect(
      lastValueFrom(
        interceptor.intercept(ctxCom({ 'idempotency-key': CHAVE }), {
          handle: () => of({}),
        }),
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('chave "processando" velha (>10 min) é assumida e o handler executa', async () => {
    const { prisma, idempotencyKey } = prismaMock();
    (prisma.idempotencyKey.findUnique as jest.Mock).mockResolvedValue({
      key: CHAVE,
      status: 'processando',
      createdAt: new Date(Date.now() - 11 * 60 * 1000),
    });
    const interceptor = new IdempotencyInterceptor(prisma);
    const handle = jest.fn(() => of({ data: 'executado' }));
    const r = await lastValueFrom(
      interceptor.intercept(ctxCom({ 'idempotency-key': CHAVE }), { handle }),
    );
    expect(r).toEqual({ data: 'executado' });
    expect(handle).toHaveBeenCalled();
    expect(idempotencyKey.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'processando' }),
      }),
    );
  });

  it('falha do handler libera a chave e propaga o erro', async () => {
    const { prisma, idempotencyKey } = prismaMock();
    const interceptor = new IdempotencyInterceptor(prisma);
    const next: CallHandler = {
      handle: () => throwError(() => new Error('boom')),
    };
    await expect(
      lastValueFrom(
        interceptor.intercept(ctxCom({ 'idempotency-key': CHAVE }), next),
      ),
    ).rejects.toThrow('boom');
    expect(idempotencyKey.delete).toHaveBeenCalledWith({ where: { key: CHAVE } });
  });

  it('grava a resposta sem a foto (photo: null)', async () => {
    const { prisma, idempotencyKey } = prismaMock();
    const interceptor = new IdempotencyInterceptor(prisma);
    const next: CallHandler = {
      handle: () =>
        of({
          data: { id: 'r1', photo: 'data:image/jpeg;base64,xxxx' },
          message: 'ok',
        }),
    };
    const r = await lastValueFrom(
      interceptor.intercept(ctxCom({ 'idempotency-key': CHAVE }), next),
    );
    expect(r).toEqual({
      data: { id: 'r1', photo: 'data:image/jpeg;base64,xxxx' },
      message: 'ok',
    });
    expect(idempotencyKey.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'concluido',
          resposta: { data: { id: 'r1', photo: null }, message: 'ok' },
        }),
      }),
    );
  });

  it('chave malformada responde 400 sem tocar o Postgres', async () => {
    const { prisma } = prismaMock();
    const interceptor = new IdempotencyInterceptor(prisma);
    await expect(
      lastValueFrom(
        interceptor.intercept(ctxCom({ 'idempotency-key': 'a/b' }), {
          handle: () => of({}),
        }),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('replay com a mesma chave em rota diferente responde 409', async () => {
    const { prisma } = prismaMock();
    (prisma.idempotencyKey.findUnique as jest.Mock).mockResolvedValue({
      key: CHAVE,
      status: 'concluido',
      resposta: { data: 'anterior' },
      rota: 'POST /outra-rota',
      createdAt: new Date(),
    });
    const interceptor = new IdempotencyInterceptor(prisma);
    await expect(
      lastValueFrom(
        interceptor.intercept(ctxCom({ 'idempotency-key': CHAVE }), {
          handle: () => of({}),
        }),
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
