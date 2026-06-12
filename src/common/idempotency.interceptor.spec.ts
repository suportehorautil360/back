import { ConflictException } from '@nestjs/common';
import type { CallHandler, ExecutionContext } from '@nestjs/common';
import { lastValueFrom, of, throwError } from 'rxjs';
import { IdempotencyInterceptor } from './idempotency.interceptor';
import type { FirebaseService } from '../config/firebase.service';

function ctxCom(headers: Record<string, string>): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ headers }) }),
  } as unknown as ExecutionContext;
}

function firebaseMock() {
  const doc = {
    create: jest.fn().mockResolvedValue(undefined),
    get: jest.fn(),
    set: jest.fn().mockResolvedValue(undefined),
    delete: jest.fn().mockResolvedValue(undefined),
  };
  const firebase = {
    getFirestore: () => ({ collection: () => ({ doc: () => doc }) }),
  } as unknown as FirebaseService;
  return { firebase, doc };
}

describe('IdempotencyInterceptor', () => {
  it('sem header, passa direto sem tocar o Firestore', async () => {
    const { firebase, doc } = firebaseMock();
    const interceptor = new IdempotencyInterceptor(firebase);
    const next: CallHandler = { handle: () => of({ data: 1 }) };
    const r = await lastValueFrom(interceptor.intercept(ctxCom({}), next));
    expect(r).toEqual({ data: 1 });
    expect(doc.create).not.toHaveBeenCalled();
  });

  it('primeira chamada executa o handler e grava a resposta', async () => {
    const { firebase, doc } = firebaseMock();
    const interceptor = new IdempotencyInterceptor(firebase);
    const next: CallHandler = { handle: () => of({ data: 'novo' }) };
    const r = await lastValueFrom(
      interceptor.intercept(ctxCom({ 'idempotency-key': 'abc' }), next),
    );
    expect(r).toEqual({ data: 'novo' });
    expect(doc.create).toHaveBeenCalled();
    expect(doc.set).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'concluido', resposta: { data: 'novo' } }),
      { merge: true },
    );
  });

  it('chave repetida concluída devolve a resposta gravada sem reexecutar', async () => {
    const { firebase, doc } = firebaseMock();
    doc.create.mockRejectedValue(new Error('ALREADY_EXISTS'));
    doc.get.mockResolvedValue({
      data: () => ({ status: 'concluido', resposta: { data: 'anterior' } }),
    });
    const interceptor = new IdempotencyInterceptor(firebase);
    const handle = jest.fn(() => of({ data: 'nao-deveria' }));
    const r = await lastValueFrom(
      interceptor.intercept(ctxCom({ 'idempotency-key': 'abc' }), { handle }),
    );
    expect(r).toEqual({ data: 'anterior' });
    expect(handle).not.toHaveBeenCalled();
  });

  it('chave repetida ainda em processamento responde 409', async () => {
    const { firebase, doc } = firebaseMock();
    doc.create.mockRejectedValue(new Error('ALREADY_EXISTS'));
    doc.get.mockResolvedValue({ data: () => ({ status: 'processando' }) });
    const interceptor = new IdempotencyInterceptor(firebase);
    await expect(
      lastValueFrom(
        interceptor.intercept(ctxCom({ 'idempotency-key': 'abc' }), {
          handle: () => of({}),
        }),
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('falha do handler libera a chave e propaga o erro', async () => {
    const { firebase, doc } = firebaseMock();
    const interceptor = new IdempotencyInterceptor(firebase);
    const next: CallHandler = { handle: () => throwError(() => new Error('boom')) };
    await expect(
      lastValueFrom(
        interceptor.intercept(ctxCom({ 'idempotency-key': 'abc' }), next),
      ),
    ).rejects.toThrow('boom');
    expect(doc.delete).toHaveBeenCalled();
  });
});
