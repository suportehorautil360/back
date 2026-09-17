import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { AlmoxarifadoService } from './almoxarifado.service';
import { Prisma } from '../../prisma/generated/client';

/**
 * Task 8: prova a FIAÇÃO do serviço — `criarTransferencia`/`expedirTransferencia`/
 * `receberTransferencia`/`cancelarTransferencia` de `AlmoxarifadoService` — que
 * `transferencia.spec.ts` não cobre porque testa as quatro funções puras
 * diretamente, sem passar pelo `this.prisma.$transaction`/`comRetryDeContencao`
 * do serviço.
 *
 * Banco falso que PERSISTE de verdade entre chamadas (molde de
 * `compras/banco-falso.fake-spec.ts`): `$transaction` tira uma cópia das
 * tabelas ANTES de rodar e as restaura se `fn` lançar — o `ROLLBACK` que um
 * Postgres de verdade dá de graça. É essa cópia/restauração que prova que a
 * transação envolve TUDO: se alguém apagar o `$transaction` do serviço (deixar
 * o ato rodar direto em cima do client, sem transação), os mesmos delegates
 * continuam existindo (o teste não quebra por "método inexistente") mas o
 * rollback deixa de acontecer — e é isso que os testes de "falha no meio"
 * abaixo pegam.
 */

const COMPANY = '11111111-1111-1111-1111-111111111111';
const OUTRA = '22222222-2222-2222-2222-222222222222';
const AUTOR = '44444444-4444-4444-4444-444444444444';

// A numeração (`TRF-2026-...`) depende do ano corrente — sem congelar o
// relógio a suíte quebra sozinha em 2027-01-01. Mesmo motivo de
// `transferencia.spec.ts`.
beforeEach(() => {
  jest.useFakeTimers().setSystemTime(new Date('2026-09-17T12:00:00.000Z'));
});

afterEach(() => {
  jest.useRealTimers();
});

type Linha = Record<string, any>;

/** Formato CLÁSSICO do client sem adapter: `meta.target` como array de campos. */
function erroDeNumeroClassico(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError(
    'Unique constraint failed on the fields: (`company_id`,`numero`)',
    { code: 'P2002', clientVersion: 'teste', meta: { target: ['companyId', 'numero'] } },
  );
}

/**
 * Formato de PRODUÇÃO (Prisma 7 + `@prisma/adapter-pg`): SEM `meta.target` —
 * a causa mora em `meta.driverAdapterError.cause.constraint.fields`, com as
 * colunas cruas do Postgres. `alvoDaViolacao`/`erroDeContencaoTransitoria`
 * (`transacao.ts`) dizem ler exatamente esta forma; os testes abaixo provam
 * isso para o índice `(company_id, numero)` de `transferencias` — não só para
 * requisição/inventário, que já tinham cobertura.
 */
function erroDeNumeroAdapter(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: 'teste',
    meta: {
      driverAdapterError: {
        name: 'DriverAdapterError',
        cause: {
          kind: 'UniqueConstraintViolation',
          originalCode: '23505',
          constraint: { fields: ['company_id', 'numero'] },
        },
      },
    },
  });
}

/**
 * Cópia profunda que preserva `Date` — mesmo motivo de `clonar` em
 * `compras/banco-falso.fake-spec.ts`: `structuredClone` devolveria um `Date`
 * de outro realm e quebraria `instanceof Date` no sandbox do jest.
 */
function clonar<T>(valor: T): T {
  if (valor instanceof Date) return new Date(valor.getTime()) as T;
  if (Array.isArray(valor)) return valor.map((v) => clonar(v)) as T;
  if (valor !== null && typeof valor === 'object') {
    return Object.fromEntries(Object.entries(valor as object).map(([k, v]) => [k, clonar(v)])) as T;
  }
  return valor;
}

function montarBanco() {
  const depositos: Linha[] = [
    { id: 'dep-a', companyId: COMPANY, ativo: true },
    { id: 'dep-b', companyId: COMPANY, ativo: true },
  ];
  const pecas: Linha[] = [
    { id: 'p-1', companyId: COMPANY, ativo: true, codigoInterno: 'ALM-000001' },
    { id: 'p-2', companyId: COMPANY, ativo: true, codigoInterno: 'ALM-000002' },
  ];
  const companyUsers: Linha[] = [{ id: AUTOR, companyId: COMPANY, name: 'Ana', email: 'ana@x.com' }];
  // As tabelas que os quatro atos ESCREVEM — só estas precisam entrar no
  // snapshot/restauração do `$transaction` fake.
  const transferencias: Linha[] = [];
  const itens: Linha[] = [];
  const saldos: Linha[] = [];
  const movimentos: Linha[] = [];
  const auditoria: Linha[] = [];
  const tabelas = { transferencias, itens, saldos, movimentos, auditoria };

  const ganchos: { erroNoProximoCreate?: unknown } = {};
  let seqTransferencia = 0;
  let seqMovimento = 0;

  const saldoDe = (pecaId: string, depositoId: string) =>
    saldos.find((s) => s.pecaId === pecaId && s.depositoId === depositoId) ?? null;

  const banco: Linha = {
    $queryRaw: jest.fn(async (q: { text: string; values: unknown[] }) => {
      if (!q.text.includes('FOR UPDATE')) {
        throw new Error(`banco falso: SQL sem FOR UPDATE — ${q.text}`);
      }
      if (q.text.includes('FROM transferencias')) {
        const [id, companyId] = q.values as [string, string];
        const t = transferencias.find((x) => x.id === id && x.companyId === companyId);
        return t ? [{ id: t.id }] : [];
      }
      if (q.text.includes('FROM peca_saldos')) {
        const [pecaId, depositoId] = q.values as [string, string];
        return saldoDe(pecaId, depositoId) ? [{ peca_id: pecaId }] : [];
      }
      throw new Error(`banco falso: SQL não reconhecido — ${q.text}`);
    }),
    deposito: {
      findMany: jest.fn(async ({ where }: Linha) => {
        if (!where.companyId) throw new Error('banco falso: deposito.findMany sem escopo de empresa.');
        return depositos
          .filter((d) => where.id.in.includes(d.id) && d.companyId === where.companyId)
          .map((d) => ({ id: d.id, ativo: d.ativo }));
      }),
    },
    peca: {
      findMany: jest.fn(async ({ where }: Linha) => {
        if (where.companyId === undefined || where.ativo === undefined) {
          throw new Error('banco falso: peca.findMany sem escopo/filtro de ativo.');
        }
        return pecas
          .filter((p) => where.id.in.includes(p.id) && p.companyId === where.companyId && p.ativo === where.ativo)
          .map((p) => ({ id: p.id }));
      }),
    },
    transferencia: {
      findMany: jest.fn(async ({ where }: Linha) => {
        if (!where.companyId || typeof where.numero?.startsWith !== 'string') {
          throw new Error('banco falso: transferencia.findMany sem escopo ou prefixo de ano.');
        }
        return transferencias
          .filter((t) => t.companyId === where.companyId && (t.numero as string).startsWith(where.numero.startsWith))
          .map((t) => ({ numero: t.numero }));
      }),
      findFirst: jest.fn(async ({ where }: Linha) => {
        if (!where.companyId) throw new Error('banco falso: findFirst sem escopo de empresa.');
        const t = transferencias.find((x) => x.id === where.id && x.companyId === where.companyId);
        return t ? { ...t } : null;
      }),
      create: jest.fn(async ({ data }: Linha) => {
        if (ganchos.erroNoProximoCreate) {
          const erro = ganchos.erroNoProximoCreate;
          ganchos.erroNoProximoCreate = undefined;
          throw erro;
        }
        if (transferencias.some((t) => t.companyId === data.companyId && t.numero === data.numero)) {
          throw erroDeNumeroAdapter();
        }
        const nova = { id: `trf-${++seqTransferencia}`, ...data };
        transferencias.push(nova);
        return { id: nova.id, numero: nova.numero };
      }),
      update: jest.fn(async ({ where, data }: Linha) => {
        const t = transferencias.find((x) => x.id === where.id);
        if (!t) throw new Error('P2025: transferencia não encontrada');
        Object.assign(t, data);
        return {};
      }),
    },
    transferenciaItem: {
      createMany: jest.fn(async ({ data }: { data: Linha[] }) => {
        for (const i of data) {
          itens.push({ id: `ti-${itens.length + 1}`, custoUnit: null, quantidadeRecebida: null, motivoDivergencia: null, ...i });
        }
        return { count: data.length };
      }),
      findMany: jest.fn(async ({ where }: Linha) => {
        if (!where.transferenciaId) throw new Error('banco falso: transferenciaItem.findMany sem escopo.');
        return itens
          .filter((i) => i.transferenciaId === where.transferenciaId)
          .map((i) => ({ ...i, peca: { codigoInterno: pecas.find((p) => p.id === i.pecaId)?.codigoInterno ?? '???' } }));
      }),
      update: jest.fn(async ({ where, data }: Linha) => {
        const i = itens.find((x) => x.id === where.id);
        if (!i) throw new Error('P2025: item não encontrado');
        Object.assign(i, data);
        return {};
      }),
    },
    pecaSaldo: {
      findUnique: jest.fn(async ({ where }: Linha) => {
        const k = where.pecaId_depositoId;
        const s = saldoDe(k.pecaId, k.depositoId);
        return s ? { ...s } : null;
      }),
      findUniqueOrThrow: jest.fn(async ({ where }: Linha) => {
        const k = where.pecaId_depositoId;
        const s = saldoDe(k.pecaId, k.depositoId);
        if (!s) throw new Error('P2025: peca_saldo não encontrado');
        return { ...s };
      }),
      upsert: jest.fn(async ({ where, create }: Linha) => {
        const k = where.pecaId_depositoId;
        let s = saldoDe(k.pecaId, k.depositoId);
        if (!s) {
          s = { saldoFisico: 0, saldoReservado: 0, custoMedio: 0, ...create };
          saldos.push(s);
        }
        return { ...s };
      }),
      update: jest.fn(async ({ where, data }: Linha) => {
        const k = where.pecaId_depositoId;
        const s = saldoDe(k.pecaId, k.depositoId);
        if (!s) throw new Error('P2025: peca_saldo não encontrado');
        Object.assign(s, data);
        return {};
      }),
    },
    estoqueMovimento: {
      create: jest.fn(async ({ data }: Linha) => {
        const m = { id: `mov-${++seqMovimento}`, ...data };
        movimentos.push(m);
        return m;
      }),
    },
    companyUser: {
      findFirst: jest.fn(async ({ where }: Linha) => {
        const u = companyUsers.find((c) => c.id === where.id && c.companyId === where.companyId);
        return u ? { name: u.name, email: u.email } : null;
      }),
    },
    pontoAuditoria: {
      create: jest.fn(async ({ data }: Linha) => {
        auditoria.push({ ...data });
        return data;
      }),
    },
  };

  // `$transaction` DESFAZ tudo quando `fn` lança — o rollback que o Postgres
  // real dá de graça e que este objeto JS, sozinho, não dá. `prisma` é o
  // MESMO objeto que `banco` (mesmos delegates): se o serviço deixasse de
  // passar por `$transaction` e chamasse o ato direto em `this.prisma`, os
  // métodos ainda existiriam (nenhum "TypeError: não é função"), só que sem
  // o snapshot/restauração — é isso que os testes de "falha no meio" abaixo
  // capturam.
  const prisma = Object.assign(banco, {
    $transaction: jest.fn(async (fn: (tx: typeof banco) => Promise<unknown>) => {
      const copia = clonar(tabelas);
      try {
        return await fn(banco);
      } catch (erro) {
        for (const chave of Object.keys(tabelas) as Array<keyof typeof tabelas>) {
          tabelas[chave].length = 0;
          tabelas[chave].push(...copia[chave]);
        }
        throw erro;
      }
    }),
  });

  return { prisma, tabelas, ganchos, depositos, pecas };
}

describe('AlmoxarifadoService.criarTransferencia — colisão de número (achado da revisão)', () => {
  it('formato CLÁSSICO (meta.target): primeira tentativa colide, a segunda passa, e o chamador recebe a transferência criada — não um 500', async () => {
    const banco = montarBanco();
    banco.ganchos.erroNoProximoCreate = erroDeNumeroClassico();
    const servico = new AlmoxarifadoService(banco.prisma as never);

    const r = await servico.criarTransferencia({
      companyId: COMPANY, depositoOrigemId: 'dep-a', depositoDestinoId: 'dep-b',
      itens: [{ pecaId: 'p-1', quantidade: 2 }], autorCompanyUserId: AUTOR, observacao: null,
    });

    expect(r).toMatchObject({ numero: 'TRF-2026-001', itens: 1 });
    expect(banco.prisma.$transaction).toHaveBeenCalledTimes(2);
    // Só UMA transferência gravada no final — a tentativa que colidiu não
    // deixou rascunho nenhum para trás.
    expect(banco.tabelas.transferencias).toHaveLength(1);
    expect(banco.tabelas.transferencias[0].numero).toBe('TRF-2026-001');
  });

  it('formato de PRODUÇÃO (Prisma 7 + adapter-pg, sem meta.target): mesma prova', async () => {
    const banco = montarBanco();
    banco.ganchos.erroNoProximoCreate = erroDeNumeroAdapter();
    const servico = new AlmoxarifadoService(banco.prisma as never);

    const r = await servico.criarTransferencia({
      companyId: COMPANY, depositoOrigemId: 'dep-a', depositoDestinoId: 'dep-b',
      itens: [{ pecaId: 'p-1', quantidade: 2 }], autorCompanyUserId: AUTOR, observacao: null,
    });

    expect(r).toMatchObject({ numero: 'TRF-2026-001', itens: 1 });
    expect(banco.prisma.$transaction).toHaveBeenCalledTimes(2);
    expect(banco.tabelas.transferencias).toHaveLength(1);
  });

  it('recusa de domínio (origem === destino) NÃO é retentada: uma tentativa só, e a exceção propaga — não vira 500 nem 200', async () => {
    const banco = montarBanco();
    const servico = new AlmoxarifadoService(banco.prisma as never);

    await expect(
      servico.criarTransferencia({
        companyId: COMPANY, depositoOrigemId: 'dep-a', depositoDestinoId: 'dep-a',
        itens: [{ pecaId: 'p-1', quantidade: 2 }], autorCompanyUserId: AUTOR, observacao: null,
      }),
    ).rejects.toThrow(BadRequestException);
    expect(banco.prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(banco.tabelas.transferencias).toHaveLength(0);
  });

  it('transferência de OUTRA empresa não é encontrada (404, não 200) — cancelar', async () => {
    const banco = montarBanco();
    banco.tabelas.transferencias.push({
      id: 'trf-1', companyId: COMPANY, numero: 'TRF-2026-001', status: 'rascunho',
      depositoOrigemId: 'dep-a', depositoDestinoId: 'dep-b',
    });
    const servico = new AlmoxarifadoService(banco.prisma as never);

    await expect(
      servico.cancelarTransferencia({
        companyId: OUTRA, transferenciaId: 'trf-1', autorCompanyUserId: AUTOR, motivo: 'teste',
      }),
    ).rejects.toThrow(NotFoundException);
    // Nada mudou: nem status, nem contagem de linhas.
    expect(banco.tabelas.transferencias[0].status).toBe('rascunho');
  });
});

describe('AlmoxarifadoService.expedirTransferencia — a transação envolve TUDO', () => {
  function plantarRascunhoComDoisItens(banco: ReturnType<typeof montarBanco>) {
    banco.tabelas.transferencias.push({
      id: 'trf-1', companyId: COMPANY, numero: 'TRF-2026-001', status: 'rascunho',
      depositoOrigemId: 'dep-a', depositoDestinoId: 'dep-b',
    });
    banco.tabelas.itens.push(
      { id: 'ti-1', transferenciaId: 'trf-1', pecaId: 'p-1', quantidade: 4, custoUnit: null },
      { id: 'ti-2', transferenciaId: 'trf-1', pecaId: 'p-2', quantidade: 5, custoUnit: null },
    );
    banco.tabelas.saldos.push(
      { pecaId: 'p-1', depositoId: 'dep-a', saldoFisico: 10, saldoReservado: 0, custoMedio: 7 },
      // Só 1 de físico para uma quantidade de 5 — o segundo item SEMPRE
      // recusa, depois que o primeiro (`p-1` < `p-2`, mesma ordem de
      // `compararPorPecaEDeposito`) já baixou o saldo dele de verdade.
      { pecaId: 'p-2', depositoId: 'dep-a', saldoFisico: 1, saldoReservado: 0, custoMedio: 3 },
    );
  }

  it('recusa no SEGUNDO item desfaz o que o primeiro já tinha gravado — nada fica no banco', async () => {
    const banco = montarBanco();
    plantarRascunhoComDoisItens(banco);
    const servico = new AlmoxarifadoService(banco.prisma as never);

    await expect(
      servico.expedirTransferencia({ companyId: COMPANY, transferenciaId: 'trf-1', autorCompanyUserId: AUTOR }),
    ).rejects.toThrow(ConflictException);

    // Sem o `$transaction` envolvendo tudo, `p-1` teria baixado de 10 para 6
    // e um movimento teria sido gravado — e ficado assim, com a
    // transferência ainda "rascunho" mas o físico já mexido por baixo dos
    // panos. Com o rollback, nada disso sobrevive.
    expect(banco.tabelas.saldos.find((s) => s.pecaId === 'p-1')!.saldoFisico).toBe(10);
    expect(banco.tabelas.movimentos).toHaveLength(0);
    expect(banco.tabelas.transferencias[0].status).toBe('rascunho');
    expect(banco.tabelas.itens.find((i) => i.id === 'ti-1')!.custoUnit).toBeNull();
  });

  it('sem a recusa, expede os dois itens e fecha como em_transito', async () => {
    const banco = montarBanco();
    plantarRascunhoComDoisItens(banco);
    // Dá saldo suficiente para o segundo item também.
    banco.tabelas.saldos.find((s) => s.pecaId === 'p-2')!.saldoFisico = 10;
    const servico = new AlmoxarifadoService(banco.prisma as never);

    const r = await servico.expedirTransferencia({
      companyId: COMPANY, transferenciaId: 'trf-1', autorCompanyUserId: AUTOR,
    });

    expect(r).toMatchObject({ numero: 'TRF-2026-001', itens: 2 });
    expect(banco.tabelas.transferencias[0].status).toBe('em_transito');
    expect(banco.tabelas.movimentos).toHaveLength(2);
  });

  it('transferência de OUTRA empresa não é encontrada (404, não 200) — expedir', async () => {
    const banco = montarBanco();
    plantarRascunhoComDoisItens(banco);
    const servico = new AlmoxarifadoService(banco.prisma as never);

    await expect(
      servico.expedirTransferencia({ companyId: OUTRA, transferenciaId: 'trf-1', autorCompanyUserId: AUTOR }),
    ).rejects.toThrow(NotFoundException);
  });
});

describe('AlmoxarifadoService.receberTransferencia e cancelarTransferencia — fiação básica', () => {
  it('recebe e fecha como recebida', async () => {
    const banco = montarBanco();
    banco.tabelas.transferencias.push({
      id: 'trf-1', companyId: COMPANY, numero: 'TRF-2026-001', status: 'em_transito',
      depositoOrigemId: 'dep-a', depositoDestinoId: 'dep-b',
    });
    banco.tabelas.itens.push({ id: 'ti-1', transferenciaId: 'trf-1', pecaId: 'p-1', quantidade: 4, custoUnit: 7 });
    const servico = new AlmoxarifadoService(banco.prisma as never);

    const r = await servico.receberTransferencia({
      companyId: COMPANY, transferenciaId: 'trf-1', autorCompanyUserId: AUTOR,
      itens: [{ itemId: 'ti-1', quantidadeRecebida: 4, motivoDivergencia: null }],
    });

    expect(r).toMatchObject({ numero: 'TRF-2026-001', comDivergencia: 0 });
    expect(banco.tabelas.transferencias[0].status).toBe('recebida');
    expect(banco.tabelas.saldos.find((s) => s.pecaId === 'p-1' && s.depositoId === 'dep-b')!.saldoFisico).toBe(4);
  });

  it('cancela o rascunho', async () => {
    const banco = montarBanco();
    banco.tabelas.transferencias.push({
      id: 'trf-1', companyId: COMPANY, numero: 'TRF-2026-001', status: 'rascunho',
      depositoOrigemId: 'dep-a', depositoDestinoId: 'dep-b',
    });
    const servico = new AlmoxarifadoService(banco.prisma as never);

    const r = await servico.cancelarTransferencia({
      companyId: COMPANY, transferenciaId: 'trf-1', autorCompanyUserId: AUTOR, motivo: 'Pedido duplicado',
    });

    expect(r).toMatchObject({ numero: 'TRF-2026-001' });
    expect(banco.tabelas.transferencias[0].status).toBe('cancelada');
  });
});
