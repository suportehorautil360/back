import { BadRequestException, ConflictException } from '@nestjs/common';
import type { CallHandler, ExecutionContext } from '@nestjs/common';
import { lastValueFrom, of, throwError } from 'rxjs';
import { IdempotencyInterceptor } from './idempotency.interceptor';
import type { FirebaseService } from '../config/firebase.service';

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

function firebaseMock() {
  const doc = {
    get: jest.fn(),
    set: jest.fn().mockResolvedValue(undefined),
    delete: jest.fn().mockResolvedValue(undefined),
  };
  const tx = {
    get: jest.fn().mockResolvedValue({ exists: false, data: () => undefined }),
    set: jest.fn(),
  };
  const runTransaction = jest.fn(
    async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx),
  );
  const firebase = {
    getFirestore: () => ({
      collection: () => ({ doc: () => doc }),
      runTransaction,
    }),
  } as unknown as FirebaseService;
  return { firebase, doc, tx, runTransaction };
}

describe('IdempotencyInterceptor', () => {
  it('sem header, passa direto sem tocar o Firestore', async () => {
    const { firebase, runTransaction } = firebaseMock();
    const interceptor = new IdempotencyInterceptor(firebase);
    const next: CallHandler = { handle: () => of({ data: 1 }) };
    const r = await lastValueFrom(interceptor.intercept(ctxCom({}), next));
    expect(r).toEqual({ data: 1 });
    expect(runTransaction).not.toHaveBeenCalled();
  });

  it('primeira chamada reserva na transação, executa o handler e grava a resposta', async () => {
    const { firebase, doc, tx } = firebaseMock();
    const interceptor = new IdempotencyInterceptor(firebase);
    const next: CallHandler = { handle: () => of({ data: 'novo' }) };
    const r = await lastValueFrom(
      interceptor.intercept(ctxCom({ 'idempotency-key': CHAVE }), next),
    );
    expect(r).toEqual({ data: 'novo' });
    expect(tx.set).toHaveBeenCalledWith(
      doc,
      expect.objectContaining({
        status: 'processando',
        rota: 'POST /time-records',
      }),
    );
    expect(doc.set).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'concluido',
        resposta: { data: 'novo' },
      }),
      { merge: true },
    );
  });

  it('chave repetida concluída devolve a resposta gravada sem reexecutar', async () => {
    const { firebase, tx } = firebaseMock();
    tx.get.mockResolvedValue({
      exists: true,
      data: () => ({
        status: 'concluido',
        resposta: { data: 'anterior' },
        rota: 'POST /time-records',
      }),
    });
    const interceptor = new IdempotencyInterceptor(firebase);
    const handle = jest.fn(() => of({ data: 'nao-deveria' }));
    const r = await lastValueFrom(
      interceptor.intercept(ctxCom({ 'idempotency-key': CHAVE }), { handle }),
    );
    expect(r).toEqual({ data: 'anterior' });
    expect(handle).not.toHaveBeenCalled();
  });

  it('chave repetida ainda em processamento (recente) responde 409', async () => {
    const { firebase, tx } = firebaseMock();
    tx.get.mockResolvedValue({
      exists: true,
      data: () => ({
        status: 'processando',
        criadoEm: new Date().toISOString(),
      }),
    });
    const interceptor = new IdempotencyInterceptor(firebase);
    await expect(
      lastValueFrom(
        interceptor.intercept(ctxCom({ 'idempotency-key': CHAVE }), {
          handle: () => of({}),
        }),
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('chave "processando" velha (>10 min) é assumida e o handler executa', async () => {
    const { firebase, tx } = firebaseMock();
    tx.get.mockResolvedValue({
      exists: true,
      data: () => ({
        status: 'processando',
        criadoEm: new Date(Date.now() - 11 * 60 * 1000).toISOString(),
      }),
    });
    const interceptor = new IdempotencyInterceptor(firebase);
    const handle = jest.fn(() => of({ data: 'executado' }));
    const r = await lastValueFrom(
      interceptor.intercept(ctxCom({ 'idempotency-key': CHAVE }), { handle }),
    );
    expect(r).toEqual({ data: 'executado' });
    expect(handle).toHaveBeenCalled();
    expect(tx.set).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ status: 'processando' }),
      { merge: true },
    );
  });

  it('falha do handler libera a chave e propaga o erro', async () => {
    const { firebase, doc } = firebaseMock();
    const interceptor = new IdempotencyInterceptor(firebase);
    const next: CallHandler = {
      handle: () => throwError(() => new Error('boom')),
    };
    await expect(
      lastValueFrom(
        interceptor.intercept(ctxCom({ 'idempotency-key': CHAVE }), next),
      ),
    ).rejects.toThrow('boom');
    expect(doc.delete).toHaveBeenCalled();
  });

  it('falha do delete ao liberar a chave gera warn (sem engolir o erro original)', async () => {
    const { firebase, doc } = firebaseMock();
    doc.delete.mockRejectedValue(new Error('indisponivel'));
    const interceptor = new IdempotencyInterceptor(firebase);
    const warn = jest
      .spyOn(interceptor['logger'], 'warn')
      .mockImplementation(() => undefined);
    await expect(
      lastValueFrom(
        interceptor.intercept(ctxCom({ 'idempotency-key': CHAVE }), {
          handle: () => throwError(() => new Error('boom')),
        }),
      ),
    ).rejects.toThrow('boom');
    expect(warn).toHaveBeenCalled();
  });

  it('grava a resposta sem a foto (photo: null)', async () => {
    const { firebase, doc } = firebaseMock();
    const interceptor = new IdempotencyInterceptor(firebase);
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
    // A resposta ao cliente segue completa; só a cópia gravada perde a foto.
    expect(r).toEqual({
      data: { id: 'r1', photo: 'data:image/jpeg;base64,xxxx' },
      message: 'ok',
    });
    expect(doc.set).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'concluido',
        resposta: { data: { id: 'r1', photo: null }, message: 'ok' },
      }),
      { merge: true },
    );
  });

  it('grava a resposta sem o anexo (anexoDataUrl: null) — solicitações', async () => {
    const { firebase, doc } = firebaseMock();
    const interceptor = new IdempotencyInterceptor(firebase);
    const next: CallHandler = {
      handle: () =>
        of({
          data: { id: 's1', anexoDataUrl: 'data:application/pdf;base64,yyyy' },
          message: 'ok',
        }),
    };
    const r = await lastValueFrom(
      interceptor.intercept(ctxCom({ 'idempotency-key': CHAVE }), next),
    );
    // Resposta ao cliente completa; só a cópia gravada perde o anexo pesado.
    expect(r).toEqual({
      data: { id: 's1', anexoDataUrl: 'data:application/pdf;base64,yyyy' },
      message: 'ok',
    });
    expect(doc.set).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'concluido',
        resposta: { data: { id: 's1', anexoDataUrl: null }, message: 'ok' },
      }),
      { merge: true },
    );
  });

  it('falha do set final não derruba a resposta nem libera a chave', async () => {
    const { firebase, doc } = firebaseMock();
    doc.set
      .mockRejectedValueOnce(new Error('payload grande demais'))
      .mockResolvedValueOnce(undefined);
    const interceptor = new IdempotencyInterceptor(firebase);
    const next: CallHandler = { handle: () => of({ data: 'novo' }) };
    const r = await lastValueFrom(
      interceptor.intercept(ctxCom({ 'idempotency-key': CHAVE }), next),
    );
    expect(r).toEqual({ data: 'novo' });
    expect(doc.delete).not.toHaveBeenCalled();
    // Fallback enxuto: marca concluído sem resposta.
    expect(doc.set).toHaveBeenLastCalledWith(
      { status: 'concluido', resposta: null },
      { merge: true },
    );
  });

  it('falha do set final E do fallback gera warn e ainda devolve a resposta', async () => {
    const { firebase, doc } = firebaseMock();
    doc.set.mockRejectedValue(new Error('firestore fora'));
    const interceptor = new IdempotencyInterceptor(firebase);
    const warn = jest
      .spyOn(interceptor['logger'], 'warn')
      .mockImplementation(() => undefined);
    const r = await lastValueFrom(
      interceptor.intercept(ctxCom({ 'idempotency-key': CHAVE }), {
        handle: () => of({ data: 'novo' }),
      }),
    );
    expect(r).toEqual({ data: 'novo' });
    expect(doc.delete).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalled();
  });

  it('chave malformada responde 400 sem tocar o Firestore', async () => {
    const { firebase, runTransaction } = firebaseMock();
    const interceptor = new IdempotencyInterceptor(firebase);
    await expect(
      lastValueFrom(
        interceptor.intercept(ctxCom({ 'idempotency-key': 'a/b' }), {
          handle: () => of({}),
        }),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(runTransaction).not.toHaveBeenCalled();
  });

  it('replay com a mesma chave em rota diferente responde 409', async () => {
    const { firebase, tx } = firebaseMock();
    tx.get.mockResolvedValue({
      exists: true,
      data: () => ({
        status: 'concluido',
        resposta: { data: 'anterior' },
        rota: 'POST /outra-rota',
      }),
    });
    const interceptor = new IdempotencyInterceptor(firebase);
    await expect(
      lastValueFrom(
        interceptor.intercept(ctxCom({ 'idempotency-key': CHAVE }), {
          handle: () => of({}),
        }),
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('erro real do Firestore na transação propaga (não vira 409)', async () => {
    const { firebase, runTransaction } = firebaseMock();
    const erro = new Error('UNAVAILABLE');
    runTransaction.mockRejectedValue(erro);
    const interceptor = new IdempotencyInterceptor(firebase);
    await expect(
      lastValueFrom(
        interceptor.intercept(ctxCom({ 'idempotency-key': CHAVE }), {
          handle: () => of({}),
        }),
      ),
    ).rejects.toBe(erro);
  });
});
