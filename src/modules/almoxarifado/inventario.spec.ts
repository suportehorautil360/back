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
  // Cadastro de peça — só o que a apuração lê pra identificar a peça na
  // mensagem de recusa (`codigoInterno`, via join no MESMO `findMany`).
  // `p-3` de propósito SEM linha em `saldos`: é a peça "nunca existiu neste
  // depósito" que o teste de entrada exercita.
  const pecas = new Map<string, Linha>([
    ['p-1', { codigoInterno: 'ALM-0001' }],
    ['p-2', { codigoInterno: 'ALM-0002' }],
    ['p-3', { codigoInterno: 'ALM-0003' }],
  ]);
  const movimentos: Linha[] = [];
  const auditoria: Linha[] = [];
  const estado = { log, inventario, itens, saldos, movimentos, auditoria };

  // Log de desfazimento: cada escrita empilha como reverter A SI MESMA.
  // Existe só para o teste de atomicidade (`comoTransacao` abaixo) poder
  // provar que uma exceção no MEIO do laço desfaz o que um item anterior já
  // tinha gravado — a garantia que, numa transação real, o `ROLLBACK` do
  // Postgres dá de graça e que um objeto JS simples, sozinho, não dá.
  const desfazer: Array<() => void> = [];
  function gravar<T extends object>(alvo: T, dados: Partial<T>): void {
    const antes = {} as Partial<T>;
    for (const k of Object.keys(dados) as (keyof T)[]) antes[k] = alvo[k];
    Object.assign(alvo, dados);
    desfazer.push(() => Object.assign(alvo, antes));
  }
  function criar<T>(lista: T[], linha: T): void {
    lista.push(linha);
    desfazer.push(() => {
      const i = lista.indexOf(linha);
      if (i >= 0) lista.splice(i, 1);
    });
  }

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
        gravar(inventario, data);
        return {};
      }),
    },
    inventarioItem: {
      findMany: jest.fn(async ({ where }: { where: { inventarioId: string } }) => {
        if (where.inventarioId !== inventario.id) return [];
        return itens.map((i) => {
          const peca = pecas.get(i.pecaId);
          if (!peca) {
            throw new Error(`banco falso: peça ${i.pecaId} sem cadastro no fixture de pecas — onde é isso?`);
          }
          return { ...i, peca: { ...peca } };
        });
      }),
      update: jest.fn(async ({ where, data }: { where: { id: string }; data: Linha }) => {
        const item = itens.find((i) => i.id === where.id);
        if (!item) throw new Error('P2025');
        gravar(item, data);
        return {};
      }),
    },
    pecaSaldo: {
      // Cria a linha do `create` quando ela ainda não existe — mesmo
      // comportamento de um `upsert` de verdade. Sem isto, apagar o upsert
      // da produção não quebraria teste nenhum: a peça "nunca contada
      // neste depósito" (Achado 2 do round 1) precisa dele para existir.
      upsert: jest.fn(
        async ({ create }: { create: { pecaId: string; depositoId: string } }) => {
          const k = chave(create.pecaId, create.depositoId);
          if (!saldos.has(k)) {
            saldos.set(k, { saldoFisico: 0, saldoReservado: 0, custoMedio: 0 });
            desfazer.push(() => saldos.delete(k));
          }
          return {};
        },
      ),
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
          gravar(s, data);
          return {};
        },
      ),
    },
    estoqueMovimento: {
      create: jest.fn(async ({ data }: { data: Linha }) => {
        const m = { id: `mov-${movimentos.length + 1}`, ...data };
        criar(movimentos, m);
        return m;
      }),
    },
    companyUser: { findFirst: jest.fn(async () => ({ name: 'Ana', email: 'a@x.com' })) },
    pontoAuditoria: {
      create: jest.fn(async ({ data }: { data: Linha }) => {
        criar(auditoria, { ...data });
        return data;
      }),
    },
  };

  // Roda `fn` (a chamada de `apurarInventario`) como se fosse a transação
  // real: se `fn` lança, desfaz TUDO que as chamadas de `tx` já tinham
  // gravado no banco falso, na ordem inversa — o `ROLLBACK` que o
  // `$transaction` de verdade dá de graça.
  async function comoTransacao<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (erro) {
      while (desfazer.length) desfazer.pop()!();
      throw erro;
    }
  }

  return { tx, estado, comoTransacao };
}

const apuracao = (extra: Partial<Record<string, unknown>> = {}) => ({
  companyId: COMPANY, inventarioId: 'inv-1',
  autorCompanyUserId: AUTOR, motivo: 'contagem de setembro', ...extra,
});

describe('apurarInventario', () => {
  it('aplica a diferença como DELTA ao saldo de agora', async () => {
    // Contado 8 contra saldo-na-contagem 10 → ajuste −2. Se o saldo de agora
    // fosse 12 (entrou peça no meio), o certo é 10, não 8.
    //
    // Acha-de propósito uma implementação que gravasse `saldoApos` como o
    // PRÓPRIO `quantidadeContada` (8) passaria despercebida se este teste só
    // olhasse o saldo final: aqui, 12−2=10 coincide numericamente com o
    // saldo do OUTRO teste (10−2=8, que por acaso é igual à quantidadeContada
    // de lá). É por isso que o movimento entra na asserção AQUI, com números
    // que não repetem essa coincidência.
    const { tx, estado } = montarApuracao();
    estado.saldos.get('p-1|dep-1')!.saldoFisico = 12;

    const r = await apurarInventario(tx as never, apuracao());

    expect(r).toMatchObject({ ajustados: 1 });
    expect(estado.saldos.get('p-1|dep-1')!.saldoFisico).toBe(10);
    expect(estado.movimentos[0]).toMatchObject({ quantidade: -2, saldoApos: 10 });
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

  it('peça sem linha de saldo no depósito conta como ENTRADA, com custo zero', async () => {
    // Mesmo raciocínio que `registrarContagem` já documenta: "conta contra
    // ZERO — ela nunca existiu ali". `p-3` não tem linha em `saldos`: o
    // `upsert` tem de criá-la (Achado 2 do round 1 de correção) para o
    // `FOR UPDATE` seguinte ter o que travar.
    const { tx, estado } = montarApuracao({
      itens: [{ id: 'ii-3', pecaId: 'p-3', quantidadeContada: 3, saldoNaContagem: 0, ajuste: null, movimentoId: null }],
    });
    const r = await apurarInventario(tx as never, apuracao());
    expect(r).toMatchObject({ ajustados: 1 });
    expect(estado.saldos.get('p-3|dep-1')).toMatchObject({ saldoFisico: 3, custoMedio: 0 });
    expect(estado.movimentos[0]).toMatchObject({
      pecaId: 'p-3', tipo: 'ajuste', quantidade: 3, saldoApos: 3, custoUnit: 0,
    });
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
    let capturado: unknown;
    try {
      await apurarInventario(tx as never, apuracao());
    } catch (erro) {
      capturado = erro;
    }
    expect(capturado).toBeInstanceOf(ConflictException);
    // A recusa identifica a peça — numa contagem de 50 itens, "trate a
    // reserva" sem dizer qual delas não ajuda ninguém (Achado 4 do round 1).
    expect((capturado as Error).message).toMatch(/ALM-0001/);
    expect(estado.movimentos).toHaveLength(0);
    expect(estado.inventario.status).toBe('aberta');
  });

  it('recusa por reservado no SEGUNDO item desfaz o que o primeiro já tinha gravado', async () => {
    // `p-1` (travado primeiro, por `compararPorPeca`) ajusta sem problema;
    // é o `p-2` que esbarra no reservado. Isto prova que a função não
    // COLETA o erro do item que falhou e segue em frente fechando a
    // contagem com o que deu certo: a exceção propaga, o inventário não
    // fecha, e o que o item `p-1` já tinha gravado não sobrevive — a mesma
    // garantia que, numa transação real, o `ROLLBACK` do `$transaction` do
    // chamador dá; `comoTransacao` simula esse `ROLLBACK` aqui.
    const { tx, estado, comoTransacao } = montarApuracao({
      itens: [
        { id: 'ii-1', pecaId: 'p-1', quantidadeContada: 8, saldoNaContagem: 10, ajuste: null, movimentoId: null },
        { id: 'ii-2', pecaId: 'p-2', quantidadeContada: 1, saldoNaContagem: 5, ajuste: null, movimentoId: null },
      ],
    });
    // Físico 5 + ajuste (1−5=−4) = 1, abaixo do reservado 4.
    estado.saldos.get('p-2|dep-1')!.saldoReservado = 4;

    let capturado: unknown;
    try {
      await comoTransacao(() => apurarInventario(tx as never, apuracao()));
    } catch (erro) {
      capturado = erro;
    }
    expect(capturado).toBeInstanceOf(ConflictException);
    expect((capturado as Error).message).toMatch(/ALM-0002/);

    // Nada do que o item `p-1` já tinha gravado sobrevive à exceção do `p-2`.
    expect(estado.movimentos).toHaveLength(0);
    expect(estado.itens[0].ajuste).toBeNull();
    expect(estado.saldos.get('p-1|dep-1')!.saldoFisico).toBe(10);
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
