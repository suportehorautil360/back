import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ObservadorDeAcesso, temCredencial } from './observador-de-acesso.guard';
import { PUBLICO_KEY } from './publico.decorator';
import type { PrismaService } from '../prisma/prisma.service';

const JWT_FALSO = 'aaaaaaaaaa.bbbbbbbbbb.cccccccccc';

function ctxHttp(headers: Record<string, unknown> = {}, metodo = 'GET'): ExecutionContext {
  return {
    getType: () => 'http',
    getClass: () => ({ name: 'FinanceiroController' }),
    getHandler: () => ({ name: 'listar' }),
    switchToHttp: () => ({ getRequest: () => ({ headers, method: metodo }) }),
  } as unknown as ExecutionContext;
}

function prismaFalso() {
  const upsert = jest.fn().mockResolvedValue({});
  return { prisma: { apiAcessoSemToken: { upsert } } as unknown as PrismaService, upsert };
}

function reflectorCom(publico = false): Reflector {
  return {
    getAllAndOverride: jest.fn((chave: string) =>
      chave === PUBLICO_KEY ? publico : undefined,
    ),
  } as unknown as Reflector;
}

/** O upsert é disparado sem await; deixa a microtask rodar. */
const drenar = () => new Promise((r) => setImmediate(r));

describe('temCredencial', () => {
  it('aceita Bearer com cara de JWT', () => {
    expect(temCredencial({ headers: { authorization: `Bearer ${JWT_FALSO}` } })).toBe(true);
  });

  it('recusa ausência de header, esquema errado e token malformado', () => {
    expect(temCredencial({ headers: {} })).toBe(false);
    expect(temCredencial({ headers: { authorization: 'Basic abc' } })).toBe(false);
    expect(temCredencial({ headers: { authorization: 'Bearer abc' } })).toBe(false);
  });
});

describe('ObservadorDeAcesso', () => {
  it('SEMPRE deixa passar — inclusive sem credencial nenhuma', async () => {
    // É a promessa da fase 2. Barrar aqui derrubaria, no meio de um turno,
    // algum cliente que a leitura de código não enxerga.
    const { prisma } = prismaFalso();
    const guard = new ObservadorDeAcesso(prisma, reflectorCom());

    expect(guard.canActivate(ctxHttp())).toBe(true);
    await drenar();
  });

  it('registra o acesso sem token, com controller e handler', async () => {
    const { prisma, upsert } = prismaFalso();
    const guard = new ObservadorDeAcesso(prisma, reflectorCom());

    guard.canActivate(ctxHttp({ origin: 'https://360.exemplo', 'user-agent': 'curl/8' }));
    await drenar();

    expect(upsert).toHaveBeenCalledTimes(1);
    expect(upsert.mock.calls[0][0].create).toMatchObject({
      controller: 'FinanceiroController',
      handler: 'listar',
      metodo: 'GET',
      origem: 'https://360.exemplo',
      userAgent: 'curl/8',
    });
  });

  it('não registra quem chegou com credencial', async () => {
    const { prisma, upsert } = prismaFalso();
    const guard = new ObservadorDeAcesso(prisma, reflectorCom());

    guard.canActivate(ctxHttp({ authorization: `Bearer ${JWT_FALSO}` }));
    await drenar();

    expect(upsert).not.toHaveBeenCalled();
  });

  it('não registra rota marcada @Publico — login é ruído conhecido', async () => {
    const { prisma, upsert } = prismaFalso();
    const guard = new ObservadorDeAcesso(prisma, reflectorCom(true));

    guard.canActivate(ctxHttp());
    await drenar();

    expect(upsert).not.toHaveBeenCalled();
  });

  it('agrupa a mesma origem sob a mesma chave', async () => {
    // Agregado, não uma linha por requisição: uma semana de tráfego viraria
    // milhões de linhas para responder o que cabe em dezenas.
    const { prisma, upsert } = prismaFalso();
    const guard = new ObservadorDeAcesso(prisma, reflectorCom());

    guard.canActivate(ctxHttp({ 'user-agent': 'curl/8' }));
    guard.canActivate(ctxHttp({ 'user-agent': 'curl/8' }));
    await drenar();

    const [a, b] = upsert.mock.calls;
    expect(a[0].where.chave).toBe(b[0].where.chave);
    expect(a[0].update).toMatchObject({ total: { increment: 1 } });
  });

  it('falha do banco não vira erro na requisição de quem está em campo', async () => {
    const upsert = jest.fn().mockRejectedValue(new Error('banco fora'));
    const prisma = { apiAcessoSemToken: { upsert } } as unknown as PrismaService;
    const guard = new ObservadorDeAcesso(prisma, reflectorCom());

    expect(guard.canActivate(ctxHttp())).toBe(true);
    await drenar();
  });

  it('contexto que não é HTTP passa sem tentar ler request', () => {
    const { prisma, upsert } = prismaFalso();
    const guard = new ObservadorDeAcesso(prisma, reflectorCom());
    const ctx = { getType: () => 'rpc' } as unknown as ExecutionContext;

    expect(guard.canActivate(ctx)).toBe(true);
    expect(upsert).not.toHaveBeenCalled();
  });

  it('corta user-agent gigante — cabeçalho de terceiro não tem limite', async () => {
    const { prisma, upsert } = prismaFalso();
    const guard = new ObservadorDeAcesso(prisma, reflectorCom());

    guard.canActivate(ctxHttp({ 'user-agent': 'x'.repeat(500) }));
    await drenar();

    expect(upsert.mock.calls[0][0].create.userAgent).toHaveLength(160);
  });
});
