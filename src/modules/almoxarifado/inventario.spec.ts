import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { abrirInventario, apurarInventario, registrarContagem } from './inventario';

const COMPANY = '11111111-1111-1111-1111-111111111111';
const AUTOR = '44444444-4444-4444-4444-444444444444';
type Linha = Record<string, any>;

function montar(opts: { jaAberta?: boolean; depositoDeOutra?: boolean } = {}) {
  const inventarios: Linha[] = opts.jaAberta
    ? [{ id: 'inv-0', companyId: COMPANY, depositoId: 'dep-1', numero: 'INV-2026-001', status: 'aberta' }]
    : [];
  const itens: Linha[] = [];
  const auditoria: Linha[] = [];
  const estado = { inventarios, itens, auditoria };

  const tx = {
    deposito: {
      findFirst: jest.fn(async ({ where }: { where: { id: string; companyId: string } }) =>
        opts.depositoDeOutra || where.companyId !== COMPANY
          ? null
          : { id: where.id, nome: 'Central' },
      ),
    },
    peca: {
      findMany: jest.fn(
        async ({
          where,
        }: {
          where: { id: { in: string[] }; companyId?: string; ativo?: boolean };
        }) => {
          if (where.companyId === undefined) {
            throw new Error('banco falso: peca.findMany sem escopo de empresa — onde é isso?');
          }
          if (where.ativo === undefined) {
            throw new Error('banco falso: peca.findMany sem filtro de ativo — onde é isso?');
          }
          if (where.companyId !== COMPANY || where.ativo !== true) return [];
          return where.id.in.filter((id) => id !== 'p-inexistente').map((id) => ({ id }));
        },
      ),
    },
    inventario: {
      findFirst: jest.fn(async ({ where }: { where: { depositoId: string; status: string } }) =>
        inventarios.find((i) => i.depositoId === where.depositoId && i.status === where.status) ?? null,
      ),
      findMany: jest.fn(
        async ({
          where,
        }: {
          where: { companyId?: string; numero?: { startsWith?: string } };
        }) => {
          if (where.companyId === undefined) {
            throw new Error('banco falso: inventario.findMany sem escopo de empresa — onde é isso?');
          }
          const prefixo = where.numero?.startsWith;
          if (typeof prefixo !== 'string') {
            throw new Error('banco falso: inventario.findMany sem prefixo de número — onde é isso?');
          }
          return inventarios
            .filter((i) => i.companyId === where.companyId && (i.numero as string).startsWith(prefixo))
            .map((i) => ({ numero: i.numero }));
        },
      ),
      create: jest.fn(async ({ data }: { data: Linha }) => {
        const novo = { id: 'inv-1', ...data };
        inventarios.push(novo);
        return novo;
      }),
    },
    inventarioItem: {
      createMany: jest.fn(async ({ data }: { data: Linha[] }) => {
        itens.push(...data);
        return { count: data.length };
      }),
    },
    companyUser: { findFirst: jest.fn(async () => ({ name: 'Ana', email: 'a@x.com' })) },
    pontoAuditoria: {
      create: jest.fn(async ({ data }: { data: Linha }) => {
        auditoria.push({ ...data });
        return data;
      }),
    },
  };
  return { tx, estado };
}

const entrada = (extra: Partial<Record<string, unknown>> = {}) => ({
  companyId: COMPANY, depositoId: 'dep-1', pecaIds: ['p-1', 'p-2'],
  autorCompanyUserId: AUTOR, observacao: 'contagem de setembro', ...extra,
});

describe('abrirInventario', () => {
  // A numeração (`INV-2026-...`) depende do ano corrente — sem congelar o
  // relógio, a suíte quebra sozinha em 2027-01-01. Mesmo padrão de
  // `uploads.service.spec.ts` (`uploadSelfiePonto`).
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2026-09-17T12:00:00.000Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('nasce aberta, numerada, com um item por peça', async () => {
    const { tx, estado } = montar();
    const r = await abrirInventario(tx as never, entrada());
    expect(r).toMatchObject({ numero: 'INV-2026-001', itens: 2 });
    expect(estado.itens).toHaveLength(2);
    expect(estado.itens[0]).toMatchObject({ inventarioId: 'inv-1', quantidadeContada: null });
  });

  it('o número continua do MAX do ano, não do total de linhas', async () => {
    const { tx } = montar({ jaAberta: true });
    // A aberta de `inv-0` é `INV-2026-001`; a próxima é a 002 — mas só depois
    // que ela for apurada. Este teste prova a numeração, não o bloqueio:
    // a de `inv-0` é de OUTRO depósito.
    const r = await abrirInventario(tx as never, entrada({ depositoId: 'dep-2' }));
    expect(r.numero).toBe('INV-2026-002');
  });

  it('depósito que já tem contagem aberta é recusado', async () => {
    const { tx } = montar({ jaAberta: true });
    await expect(abrirInventario(tx as never, entrada())).rejects.toThrow(ConflictException);
  });

  it('depósito de outra empresa não é encontrado', async () => {
    const { tx } = montar({ depositoDeOutra: true });
    await expect(abrirInventario(tx as never, entrada())).rejects.toThrow(NotFoundException);
  });

  it('peça que não existe na empresa é recusada, e nada é criado', async () => {
    const { tx, estado } = montar();
    await expect(
      abrirInventario(tx as never, entrada({ pecaIds: ['p-1', 'p-inexistente'] })),
    ).rejects.toThrow(BadRequestException);
    expect(estado.inventarios).toHaveLength(0);
  });

  it('contagem sem peça nenhuma é recusada', async () => {
    const { tx } = montar();
    await expect(abrirInventario(tx as never, entrada({ pecaIds: [] }))).rejects.toThrow(BadRequestException);
  });

  it('peça repetida na abertura vira um item só', async () => {
    const { tx, estado } = montar();
    await abrirInventario(tx as never, entrada({ pecaIds: ['p-1', 'p-1', 'p-2'] }));
    expect(estado.itens).toHaveLength(2);
  });

  it('grava o rastro da abertura', async () => {
    const { tx, estado } = montar();
    await abrirInventario(tx as never, entrada());
    expect(estado.auditoria).toEqual([
      expect.objectContaining({
        acao: 'inventario.abrir',
        alvoTipo: 'suprimentos.inventario',
        alvoId: 'inv-1',
        atorId: AUTOR,
      }),
    ]);
  });
});

function montarContagem(opts: { statusInventario?: string; semSaldo?: boolean } = {}) {
  const item: Linha = {
    id: 'ii-1', inventarioId: 'inv-1', pecaId: 'p-1',
    quantidadeContada: null, saldoNaContagem: null,
  };
  const inventario = {
    id: 'inv-1', companyId: COMPANY, depositoId: 'dep-1',
    status: opts.statusInventario ?? 'aberta',
  };
  const estado = { item, inventario };
  const tx = {
    inventarioItem: {
      findFirst: jest.fn(async ({ where }: { where: { id: string; inventario: { companyId: string } } }) => {
        if (!where.inventario?.companyId) {
          throw new Error('findFirst sem filtro de empresa — o escopo é obrigatório.');
        }
        if (where.id !== item.id || inventario.companyId !== where.inventario.companyId) return null;
        return { ...item, inventario: { ...inventario } };
      }),
      update: jest.fn(async ({ data }: { data: Linha }) => {
        Object.assign(item, data);
        return { ...item };
      }),
    },
    pecaSaldo: {
      findUnique: jest.fn(
        async ({
          where,
        }: {
          where: { pecaId_depositoId: { pecaId: string; depositoId: string } };
        }) => {
          const chave = where.pecaId_depositoId;
          if (!chave?.pecaId || !chave?.depositoId) {
            throw new Error('banco falso: pecaSaldo.findUnique sem chave composta — onde é isso?');
          }
          if (chave.pecaId !== item.pecaId || chave.depositoId !== inventario.depositoId) {
            throw new Error(
              `banco falso: pecaSaldo.findUnique com chave errada (pecaId=${chave.pecaId}, depositoId=${chave.depositoId}) — esperava pecaId=${item.pecaId}, depositoId=${inventario.depositoId}.`,
            );
          }
          return opts.semSaldo ? null : { saldoFisico: 7 };
        },
      ),
    },
  };
  return { tx, estado };
}

describe('registrarContagem', () => {
  it('grava o contado e o saldo do INSTANTE da contagem', async () => {
    const { tx, estado } = montarContagem();
    const r = await registrarContagem(tx as never, {
      companyId: COMPANY, inventarioItemId: 'ii-1', quantidadeContada: 5,
      autorCompanyUserId: AUTOR,
    });
    expect(r).toMatchObject({ quantidadeContada: 5, saldoNaContagem: 7 });
    expect(estado.item).toMatchObject({ quantidadeContada: 5, saldoNaContagem: 7 });
  });

  it('contar ZERO é contagem, não ausência de contagem', async () => {
    const { tx, estado } = montarContagem();
    await registrarContagem(tx as never, {
      companyId: COMPANY, inventarioItemId: 'ii-1', quantidadeContada: 0,
      autorCompanyUserId: AUTOR,
    });
    expect(estado.item.quantidadeContada).toBe(0);
  });

  it('peça sem linha de saldo conta contra ZERO — nunca existiu ali', async () => {
    const { tx, estado } = montarContagem({ semSaldo: true });
    await registrarContagem(tx as never, {
      companyId: COMPANY, inventarioItemId: 'ii-1', quantidadeContada: 3,
      autorCompanyUserId: AUTOR,
    });
    expect(estado.item.saldoNaContagem).toBe(0);
  });

  it('recontar substitui, e o saldo do instante acompanha', async () => {
    const { tx, estado } = montarContagem();
    await registrarContagem(tx as never, {
      companyId: COMPANY, inventarioItemId: 'ii-1', quantidadeContada: 5,
      autorCompanyUserId: AUTOR,
    });
    await registrarContagem(tx as never, {
      companyId: COMPANY, inventarioItemId: 'ii-1', quantidadeContada: 6,
      autorCompanyUserId: AUTOR,
    });
    expect(estado.item).toMatchObject({ quantidadeContada: 6, saldoNaContagem: 7 });
  });

  it('quantidade negativa é recusada', async () => {
    const { tx } = montarContagem();
    await expect(
      registrarContagem(tx as never, {
        companyId: COMPANY, inventarioItemId: 'ii-1', quantidadeContada: -1,
        autorCompanyUserId: AUTOR,
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('contagem já apurada não aceita mais contagem', async () => {
    const { tx } = montarContagem({ statusInventario: 'apurada' });
    await expect(
      registrarContagem(tx as never, {
        companyId: COMPANY, inventarioItemId: 'ii-1', quantidadeContada: 5,
        autorCompanyUserId: AUTOR,
      }),
    ).rejects.toThrow(ConflictException);
  });
});

/**
 * A chave do banco falso é COMPOSTA (`pecaId|depositoId`), nunca só `pecaId`:
 * nas Tasks 4 e 5 a revisão já reprovou duas vezes um fake de saldo que lia
 * só o `pecaId` do `where` e ignorava o `depositoId` — aqui as duas partes
 * da chave primária de `peca_saldos` entram, e uma chave que não bate LANÇA
 * (`findUniqueOrThrow`/`update`) ou devolve vazio (`$queryRaw`, que é um
 * SELECT: sem linha casada, zero linhas travadas — não é erro).
 */
function montarApuracao(opts: { itens?: Linha[]; reservado?: number; statusInventario?: string } = {}) {
  const log: string[] = [];
  const inventario = {
    id: 'inv-1', companyId: COMPANY, depositoId: 'dep-1', numero: 'INV-2026-001',
    status: opts.statusInventario ?? 'aberta',
  };
  const itens: Linha[] = opts.itens ?? [
    { id: 'ii-1', pecaId: 'p-1', quantidadeContada: 8, saldoNaContagem: 10, ajuste: null, movimentoId: null },
  ];
  const chave = (pecaId: string, depositoId: string) => `${pecaId}|${depositoId}`;
  const saldos = new Map<string, Linha>([
    [chave('p-1', 'dep-1'), { saldoFisico: 10, saldoReservado: opts.reservado ?? 0, custoMedio: 4 }],
    [chave('p-2', 'dep-1'), { saldoFisico: 5, saldoReservado: 0, custoMedio: 9 }],
  ]);
  const movimentos: Linha[] = [];
  const auditoria: Linha[] = [];
  const estado = { log, inventario, itens, saldos, movimentos, auditoria };

  const tx = {
    $queryRaw: jest.fn(async (q: { text: string; values: unknown[] }) => {
      if (q.text.includes('FROM inventarios')) {
        log.push('trava:inventario');
        return inventario.id === q.values[0] && inventario.companyId === q.values[1]
          ? [{ id: inventario.id }]
          : [];
      }
      if (q.text.includes('FROM peca_saldos')) {
        const [pecaId, depositoId] = q.values as [string, string];
        log.push(`trava:saldo:${pecaId}`);
        return saldos.has(chave(pecaId, depositoId)) ? [{ peca_id: pecaId }] : [];
      }
      throw new Error(`SQL não reconhecido: ${q.text}`);
    }),
    inventario: {
      findFirst: jest.fn(async ({ where }: { where: { id: string; companyId: string } }) =>
        where.id === inventario.id && where.companyId === inventario.companyId
          ? { ...inventario }
          : null,
      ),
      update: jest.fn(async ({ where, data }: { where: { id: string }; data: Linha }) => {
        if (where.id !== inventario.id) throw new Error('P2025');
        Object.assign(inventario, data);
        return {};
      }),
    },
    inventarioItem: {
      findMany: jest.fn(async ({ where }: { where: { inventarioId: string } }) =>
        where.inventarioId === inventario.id ? itens.map((i) => ({ ...i })) : [],
      ),
      update: jest.fn(async ({ where, data }: { where: { id: string }; data: Linha }) => {
        const item = itens.find((i) => i.id === where.id);
        if (!item) throw new Error('P2025');
        Object.assign(item, data);
        return {};
      }),
    },
    pecaSaldo: {
      upsert: jest.fn(async () => ({})),
      findUniqueOrThrow: jest.fn(
        async ({ where }: { where: { pecaId_depositoId: { pecaId: string; depositoId: string } } }) => {
          const s = saldos.get(chave(where.pecaId_depositoId.pecaId, where.pecaId_depositoId.depositoId));
          if (!s) throw new Error('P2025');
          return { ...s };
        },
      ),
      update: jest.fn(
        async ({
          where,
          data,
        }: {
          where: { pecaId_depositoId: { pecaId: string; depositoId: string } };
          data: Linha;
        }) => {
          const s = saldos.get(chave(where.pecaId_depositoId.pecaId, where.pecaId_depositoId.depositoId));
          if (!s) throw new Error('P2025');
          Object.assign(s, data);
          return {};
        },
      ),
    },
    estoqueMovimento: {
      create: jest.fn(async ({ data }: { data: Linha }) => {
        const m = { id: `mov-${movimentos.length + 1}`, ...data };
        movimentos.push(m);
        return m;
      }),
    },
    companyUser: { findFirst: jest.fn(async () => ({ name: 'Ana', email: 'a@x.com' })) },
    pontoAuditoria: {
      create: jest.fn(async ({ data }: { data: Linha }) => {
        auditoria.push({ ...data });
        return data;
      }),
    },
  };
  return { tx, estado };
}

const apuracao = (extra: Partial<Record<string, unknown>> = {}) => ({
  companyId: COMPANY, inventarioId: 'inv-1',
  autorCompanyUserId: AUTOR, motivo: 'contagem de setembro', ...extra,
});

describe('apurarInventario', () => {
  it('aplica a diferença como DELTA ao saldo de agora', async () => {
    // Contado 8 contra saldo-na-contagem 10 → ajuste −2. Se o saldo de agora
    // fosse 12 (entrou peça no meio), o certo é 10, não 8.
    const { tx, estado } = montarApuracao();
    estado.saldos.get('p-1|dep-1')!.saldoFisico = 12;

    const r = await apurarInventario(tx as never, apuracao());

    expect(r).toMatchObject({ ajustados: 1 });
    expect(estado.saldos.get('p-1|dep-1')!.saldoFisico).toBe(10);
  });

  it('grava movimento de ajuste com sinal, saldoApos e a origem', async () => {
    const { tx, estado } = montarApuracao();
    await apurarInventario(tx as never, apuracao());
    expect(estado.movimentos).toEqual([
      expect.objectContaining({
        companyId: COMPANY, pecaId: 'p-1', depositoId: 'dep-1',
        tipo: 'ajuste', quantidade: -2, saldoApos: 8,
        origemTipo: 'inventario', origemId: 'inv-1', autorCompanyUserId: AUTOR,
      }),
    ]);
  });

  it('o custo do movimento é a média do depósito, e a média NÃO muda', async () => {
    // Achar unidade a mais é erro de contagem, não compra a preço novo —
    // mesma regra que `custoEntrada = null` já aplica na devolução de sobra.
    const { tx, estado } = montarApuracao();
    await apurarInventario(tx as never, apuracao());
    expect(estado.movimentos[0].custoUnit).toBe(4);
    expect(estado.saldos.get('p-1|dep-1')!.custoMedio).toBe(4);
  });

  it('item contado que BATE não gera movimento, e fica registrado como conferido', async () => {
    const { tx, estado } = montarApuracao({
      itens: [{ id: 'ii-1', pecaId: 'p-1', quantidadeContada: 10, saldoNaContagem: 10, ajuste: null, movimentoId: null }],
    });
    const r = await apurarInventario(tx as never, apuracao());
    expect(r).toMatchObject({ ajustados: 0, semDiferenca: 1 });
    expect(estado.movimentos).toHaveLength(0);
    expect(estado.itens[0]).toMatchObject({ ajuste: 0, movimentoId: null });
  });

  it('item NÃO contado é ignorado, e não vira ajuste de menos', async () => {
    const { tx, estado } = montarApuracao({
      itens: [
        { id: 'ii-1', pecaId: 'p-1', quantidadeContada: 8, saldoNaContagem: 10, ajuste: null, movimentoId: null },
        { id: 'ii-2', pecaId: 'p-2', quantidadeContada: null, saldoNaContagem: null, ajuste: null, movimentoId: null },
      ],
    });
    await apurarInventario(tx as never, apuracao());
    expect(estado.saldos.get('p-2|dep-1')!.saldoFisico).toBe(5);
    expect(estado.itens[1].ajuste).toBeNull();
  });

  it('ajuste que derruba o físico abaixo do RESERVADO é recusado, e nada é gravado', async () => {
    // A contagem achou menos do que já está comprometido com uma OS. Isso se
    // trata na reserva antes de se tratar no saldo.
    const { tx, estado } = montarApuracao({ reservado: 9 });
    await expect(apurarInventario(tx as never, apuracao())).rejects.toThrow(ConflictException);
    expect(estado.movimentos).toHaveLength(0);
    expect(estado.inventario.status).toBe('aberta');
  });

  it('trava o inventário e depois os saldos na ordem do comparador', async () => {
    const { tx, estado } = montarApuracao({
      itens: [
        { id: 'ii-2', pecaId: 'p-2', quantidadeContada: 4, saldoNaContagem: 5, ajuste: null, movimentoId: null },
        { id: 'ii-1', pecaId: 'p-1', quantidadeContada: 8, saldoNaContagem: 10, ajuste: null, movimentoId: null },
      ],
    });
    await apurarInventario(tx as never, apuracao());
    const travas = estado.log.filter((l) => l.startsWith('trava:'));
    expect(travas[0]).toBe('trava:inventario');
    const saldos = travas.slice(1);
    expect(saldos).toEqual([...saldos].sort());
  });

  it('contagem sem nenhum item contado não apura', async () => {
    const { tx } = montarApuracao({
      itens: [{ id: 'ii-1', pecaId: 'p-1', quantidadeContada: null, saldoNaContagem: null, ajuste: null, movimentoId: null }],
    });
    await expect(apurarInventario(tx as never, apuracao())).rejects.toThrow(BadRequestException);
  });

  it('contagem já apurada não apura de novo', async () => {
    const { tx } = montarApuracao({ statusInventario: 'apurada' });
    await expect(apurarInventario(tx as never, apuracao())).rejects.toThrow(ConflictException);
  });

  it('sem motivo não apura — o acerto vai para a auditoria', async () => {
    const { tx } = montarApuracao();
    await expect(apurarInventario(tx as never, apuracao({ motivo: '  ' }))).rejects.toThrow(BadRequestException);
  });

  it('fecha a contagem e grava o rastro com o resumo', async () => {
    const { tx, estado } = montarApuracao();
    await apurarInventario(tx as never, apuracao());
    expect(estado.inventario).toMatchObject({ status: 'apurada', apuradaPorCompanyUserId: AUTOR });
    expect(estado.auditoria).toEqual([
      expect.objectContaining({
        acao: 'inventario.apurar',
        alvoTipo: 'suprimentos.inventario',
        alvoId: 'inv-1',
        motivo: 'contagem de setembro',
      }),
    ]);
  });
});
