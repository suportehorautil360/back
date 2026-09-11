/**
 * Identificar sem exigir.
 *
 * `/checklist-definitions` atende o app do operador, e o login por CHASSI não
 * tem credencial nenhuma por desenho — o chassi identifica uma máquina, não
 * uma pessoa. Exigir token ali derrubaria um fluxo legítimo de campo; ignorar
 * o token de quem TEM entregaria a lista de uma empresa a qualquer um.
 *
 * Este guard resolve os dois: diz de quem é a chamada quando dá para saber, e
 * NUNCA recusa. Cada teste aqui é uma forma de token ruim que não pode virar
 * erro na tela do operador no meio do pátio.
 */
import type { ExecutionContext } from '@nestjs/common';

import { SignJWT } from 'jose';

import {
  EmpresaDoTokenGuard,
  type LeitorDeToken,
  type RequestComEmpresaOpcional,
} from './empresa-do-token.guard';

function contexto(authorization?: string) {
  const req = { headers: authorization ? { authorization } : {} } as Record<
    string,
    unknown
  >;
  return {
    req: req as unknown as RequestComEmpresaOpcional,
    ctx: {
      switchToHttp: () => ({ getRequest: () => req }),
    } as unknown as ExecutionContext,
  };
}

function guard(opcoes: {
  ler?: LeitorDeToken;
  usuario?: { companyId: string; status: string } | null;
}) {
  const findUnique = jest.fn(() => Promise.resolve(opcoes.usuario ?? null));
  const prisma = { companyUser: { findUnique } };
  const ler: LeitorDeToken = opcoes.ler ?? (() => Promise.resolve({}));
  return {
    guard: new EmpresaDoTokenGuard(prisma as never, ler),
    findUnique,
  };
}

describe('EmpresaDoTokenGuard', () => {
  it('sem token, segue como anônimo — não recusa', async () => {
    const { guard: g } = guard({});
    const { ctx, req } = contexto();

    expect(await g.canActivate(ctx)).toBe(true);
    expect(req.companyIdOpcional).toBeNull();
  });

  /**
   * A sessão do OPERADOR carrega a empresa no próprio token
   * (`app_metadata.company_id`, posto pela edge function do login por CPF).
   * Não custa consulta, e o `sub` dele não é um `CompanyUser`.
   */
  it('lê a empresa do app_metadata do operador, sem ir ao banco', async () => {
    const { guard: g, findUnique } = guard({
      ler: () => Promise.resolve({ sub: 'op-1', companyId: 'c-1' }),
    });
    const { ctx, req } = contexto('Bearer t');

    await g.canActivate(ctx);

    expect(req.companyIdOpcional).toBe('c-1');
    expect(findUnique).not.toHaveBeenCalled();
  });

  // O usuário do PAINEL não tem `app_metadata` — a empresa dele sai do
  // cadastro, pelo `sub`, que é o `CompanyUser.id`.
  it('resolve a empresa do usuário do painel pelo sub', async () => {
    const { guard: g } = guard({
      ler: () => Promise.resolve({ sub: 'cu-1' }),
      usuario: { companyId: 'c-9', status: 'ACTIVE' },
    });
    const { ctx, req } = contexto('Bearer t');

    await g.canActivate(ctx);
    expect(req.companyIdOpcional).toBe('c-9');
  });

  // Acesso desativado é o mesmo que anônimo: vê o catálogo base, não o da
  // empresa de onde saiu.
  it('usuário desativado volta a ser anônimo', async () => {
    const { guard: g } = guard({
      ler: () => Promise.resolve({ sub: 'cu-1' }),
      usuario: { companyId: 'c-9', status: 'INACTIVE' },
    });
    const { ctx, req } = contexto('Bearer t');

    await g.canActivate(ctx);
    expect(req.companyIdOpcional).toBeNull();
  });

  it('token de usuário que sumiu do banco vira anônimo', async () => {
    const { guard: g } = guard({
      ler: () => Promise.resolve({ sub: 'fantasma' }),
      usuario: null,
    });
    const { ctx, req } = contexto('Bearer t');

    await g.canActivate(ctx);
    expect(req.companyIdOpcional).toBeNull();
  });

  /**
   * O ponto do arquivo. Um guard que recusasse aqui transformaria "sua sessão
   * venceu" em "esta tela quebrou" — e a tela é a do operador, no pátio, com a
   * máquina parada esperando o checklist.
   */
  it('token inválido NÃO recusa: vira anônimo', async () => {
    const { guard: g } = guard({
      ler: () => Promise.reject(new Error('assinatura inválida')),
    });
    const { ctx, req } = contexto('Bearer lixo');

    expect(await g.canActivate(ctx)).toBe(true);
    expect(req.companyIdOpcional).toBeNull();
  });

  it('banco fora do ar também não recusa', async () => {
    const findUnique = jest.fn(() => Promise.reject(new Error('sem conexão')));
    const g = new EmpresaDoTokenGuard(
      { companyUser: { findUnique } } as never,
      () => Promise.resolve({ sub: 'cu-1' }),
    );
    const { ctx, req } = contexto('Bearer t');

    expect(await g.canActivate(ctx)).toBe(true);
    expect(req.companyIdOpcional).toBeNull();
  });

  it('header sem "Bearer " é ignorado, e não tratado como token', async () => {
    const ler = jest.fn(() => Promise.resolve({ companyId: 'c-1' }));
    const { guard: g } = guard({ ler });
    const { ctx, req } = contexto('Basic dXNlcjpwYXNz');

    await g.canActivate(ctx);
    expect(ler).not.toHaveBeenCalled();
    expect(req.companyIdOpcional).toBeNull();
  });

  // `company_id` que não é string (null, número, objeto) não pode virar filtro.
  it('app_metadata com company_id inutilizável cai no sub', async () => {
    const { guard: g } = guard({
      ler: () => Promise.resolve({ sub: 'cu-1', companyId: undefined }),
      usuario: { companyId: 'c-2', status: 'ACTIVE' },
    });
    const { ctx, req } = contexto('Bearer t');

    await g.canActivate(ctx);
    expect(req.companyIdOpcional).toBe('c-2');
  });
});

/**
 * O terceiro cadastro: o token de MÁQUINA.
 *
 * O login por chassi passou a emitir credencial própria, HS256 com
 * `JWT_SECRET` — e não JWT do Supabase como os outros dois. Sem ele o operador
 * do chassi recebia o catálogo BASE mesmo numa empresa que personalizou o
 * dela, e a alternativa (o cliente mandar a empresa na requisição) é deixar
 * quem pergunta afirmar quem é.
 */
describe('EmpresaDoTokenGuard — token de chassi', () => {
  const SEGREDO = 'segredo-de-teste';
  const semSupabase: LeitorDeToken = () =>
    Promise.reject(new Error('não é token do Supabase'));

  function assinar(payload: Record<string, unknown>, expiraEm = '12h') {
    return new SignJWT(payload)
      .setProtectedHeader({ alg: 'HS256' })
      .setExpirationTime(expiraEm)
      .sign(new TextEncoder().encode(SEGREDO));
  }

  const anterior = process.env.JWT_SECRET;
  beforeEach(() => {
    process.env.JWT_SECRET = SEGREDO;
  });
  afterAll(() => {
    process.env.JWT_SECRET = anterior;
  });

  it('lê a empresa do token de chassi', async () => {
    const { guard: g } = guard({ ler: semSupabase });
    const token = await assinar({
      sub: 'ESC-014',
      tipo: 'chassi',
      companyId: 'c-7',
      idMaquina: 'eq-1',
    });
    const { ctx, req } = contexto(`Bearer ${token}`);

    await g.canActivate(ctx);
    expect(req.companyIdOpcional).toBe('c-7');
  });

  /**
   * O único poder deste token é dizer de que empresa é a leitura. Sem a
   * empresa ele não diz nada — e um payload assim não pode passar por
   * identificado.
   */
  it('token de chassi sem empresa não identifica ninguém', async () => {
    const { guard: g } = guard({ ler: semSupabase });
    const token = await assinar({ sub: 'ESC-014', tipo: 'chassi' });
    const { ctx, req } = contexto(`Bearer ${token}`);

    await g.canActivate(ctx);
    expect(req.companyIdOpcional).toBeNull();
  });

  // Assinado com outro segredo é forjado — e forjado não vira empresa.
  it('assinatura de outro segredo não passa', async () => {
    const { guard: g } = guard({ ler: semSupabase });
    const token = await new SignJWT({ tipo: 'chassi', companyId: 'c-7' })
      .setProtectedHeader({ alg: 'HS256' })
      .setExpirationTime('12h')
      .sign(new TextEncoder().encode('outro-segredo'));
    const { ctx, req } = contexto(`Bearer ${token}`);

    await g.canActivate(ctx);
    expect(req.companyIdOpcional).toBeNull();
  });

  it('token expirado vira anônimo, sem recusar', async () => {
    const { guard: g } = guard({ ler: semSupabase });
    const token = await assinar({ tipo: 'chassi', companyId: 'c-7' }, '-1s');
    const { ctx, req } = contexto(`Bearer ${token}`);

    expect(await g.canActivate(ctx)).toBe(true);
    expect(req.companyIdOpcional).toBeNull();
  });

  /**
   * O token de PESSOA (`tipo: 'operador'`) é assinado com o mesmo segredo e
   * passaria na verificação de assinatura. Não pode virar empresa por este
   * caminho: quem o emite é outro fluxo, com outro significado, e confundir os
   * dois é como uma credencial de máquina acabaria autorizando coisa de gente.
   */
  it('token de operador NÃO entra pelo caminho do chassi', async () => {
    const { guard: g } = guard({ ler: semSupabase });
    const token = await assinar({
      sub: 'login-123',
      tipo: 'operador',
      funcionarioId: 'f-1',
      prefeituraId: 'c-7',
    });
    const { ctx, req } = contexto(`Bearer ${token}`);

    await g.canActivate(ctx);
    expect(req.companyIdOpcional).toBeNull();
  });

  it('sem JWT_SECRET configurado, ninguém é identificado por este caminho', async () => {
    const token = await assinar({ tipo: 'chassi', companyId: 'c-7' });
    delete process.env.JWT_SECRET;

    const { guard: g } = guard({ ler: semSupabase });
    const { ctx, req } = contexto(`Bearer ${token}`);

    await g.canActivate(ctx);
    expect(req.companyIdOpcional).toBeNull();
  });
});
