import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { cancelarTransferencia, criarTransferencia, expedirTransferencia } from './transferencia';

const COMPANY = '11111111-1111-1111-1111-111111111111';
const OUTRA = '22222222-2222-2222-2222-222222222222';
const AUTOR = '44444444-4444-4444-4444-444444444444';
type Linha = Record<string, any>;

// A numeração (`TRF-2026-...`) depende do ano corrente — sem congelar o
// relógio, a suíte quebra sozinha em 2027-01-01, porque os números esperados
// abaixo são literais `TRF-2026-…` e o código tira o ano de
// `new Date().getUTCFullYear()`. Mesmo padrão de `inventario.spec.ts`
// (`describe('abrirInventario', …)`), aqui no nível do arquivo porque as duas
// describes (criar e cancelar) dependem da mesma numeração.
beforeEach(() => {
  jest.useFakeTimers().setSystemTime(new Date('2026-09-17T12:00:00.000Z'));
});

afterEach(() => {
  jest.useRealTimers();
});

function montarCriacao() {
  // Duas linhas com BURACO na sequência (001 e 003, não 001 e 002): prova que
  // o próximo número sai do MAX (004), não da CONTAGEM de linhas (que daria
  // 003, com só duas linhas existentes). Mesmo raciocínio de
  // `inventario.spec.ts` ("o número continua do MAX do ano, não do total de
  // linhas").
  const transferencias: Linha[] = [
    { id: 'trf-0', companyId: COMPANY, numero: 'TRF-2026-001', status: 'recebida' },
    { id: 'trf-buraco', companyId: COMPANY, numero: 'TRF-2026-003', status: 'cancelada' },
  ];
  // Depósitos PERSISTIDOS de verdade (não "devolve de volta o id que
  // recebeu"): só assim "depósito inexistente", "de outra empresa" e
  // "inativo" são exprimíveis, e um fake que neutralizasse a guarda deixaria
  // de passar.
  const depositos: Linha[] = [
    { id: 'dep-a', companyId: COMPANY, ativo: true },
    { id: 'dep-b', companyId: COMPANY, ativo: true },
    { id: 'dep-inativo', companyId: COMPANY, ativo: false },
    { id: 'dep-outra', companyId: OUTRA, ativo: true },
  ];
  const itens: Linha[] = [];
  const auditoria: Linha[] = [];
  // Espia a ordem trava→escrita, mesmo padrão de `inventario.spec.ts`
  // (`'trava o cabeçalho ANTES de escrever'`): prova que a trava existe e
  // acontece antes do UPDATE, não só que ela não quebra nada.
  const log: string[] = [];
  const estado = { transferencias, depositos, itens, auditoria, log };

  const tx = {
    $queryRaw: jest.fn(async (q: { text: string; values: unknown[] }) => {
      // Exige `FOR UPDATE` no texto, não só o `FROM transferencias`: sem
      // isso, apagar as duas palavras da trava real deixaria o fake
      // satisfeito — o teste provaria só "existe um SELECT antes do
      // UPDATE", não que ele TRAVA.
      if (!q.text.includes('FROM transferencias') || !q.text.includes('FOR UPDATE')) {
        throw new Error(`banco falso: SQL não reconhecido, ou sem FOR UPDATE — ${q.text}`);
      }
      log.push('trava:transferencia');
      const t = transferencias.find((x) => x.id === q.values[0] && x.companyId === q.values[1]);
      return t ? [{ id: t.id }] : [];
    }),
    deposito: {
      findMany: jest.fn(async ({ where }: { where: { id: { in: string[] }; companyId?: string } }) => {
        if (!where.companyId) throw new Error('banco falso: deposito.findMany sem escopo de empresa.');
        return depositos
          .filter((d) => where.id.in.includes(d.id) && d.companyId === where.companyId)
          .map((d) => ({ id: d.id, ativo: d.ativo }));
      }),
    },
    peca: {
      findMany: jest.fn(async ({ where }: { where: { id: { in: string[] }; companyId?: string; ativo?: boolean } }) => {
        if (where.companyId === undefined) {
          throw new Error('banco falso: peca.findMany sem escopo de empresa — onde é isso?');
        }
        if (where.ativo === undefined) {
          throw new Error('banco falso: peca.findMany sem filtro de ativo — onde é isso?');
        }
        // Confere o VALOR do filtro, não só a presença da chave: um
        // `ativo: false` (a regra invertida) tem de devolver vazio aqui.
        if (where.companyId !== COMPANY || where.ativo !== true) return [];
        // "Peça de outra empresa" modelada por ID que este fake nunca
        // reconhece — não por uma flag global que apagaria TODA peça da
        // lista, o que provaria só "quando vêm menos peças, recusa".
        return where.id.in.filter((id) => id !== 'p-de-outra-empresa').map((id) => ({ id }));
      }),
    },
    transferencia: {
      findMany: jest.fn(async ({ where }: { where: { companyId?: string; numero?: { startsWith?: string } } }) => {
        if (!where.companyId || typeof where.numero?.startsWith !== 'string') {
          throw new Error('banco falso: transferencia.findMany sem empresa ou sem prefixo de ano.');
        }
        return transferencias
          .filter((t) => t.companyId === where.companyId && (t.numero as string).startsWith(where.numero!.startsWith!))
          .map((t) => ({ numero: t.numero }));
      }),
      findFirst: jest.fn(async ({ where }: { where: { id: string; companyId: string } }) => {
        if (!where.companyId) throw new Error('banco falso: findFirst sem escopo de empresa.');
        const t = transferencias.find((x) => x.id === where.id && x.companyId === where.companyId);
        return t ? { ...t } : null;
      }),
      create: jest.fn(async ({ data }: { data: Linha }) => {
        const nova = { id: 'trf-1', ...data };
        transferencias.push(nova);
        return nova;
      }),
      update: jest.fn(async ({ where, data }: { where: { id: string }; data: Linha }) => {
        Object.assign(transferencias.find((t) => t.id === where.id)!, data);
        log.push('update:transferencia');
        return {};
      }),
    },
    transferenciaItem: {
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
    // Cancelar o RASCUNHO não move saldo nem grava movimento — estes dois
    // fakes LANÇAM se forem tocados. É assim que os testes de cancelamento
    // provam a AUSÊNCIA de efeito, não só a presença do que se espera.
    pecaSaldo: {
      update: jest.fn(async () => {
        throw new Error('cancelar rascunho NÃO pode mexer em saldo');
      }),
    },
    estoqueMovimento: {
      create: jest.fn(async () => {
        throw new Error('cancelar rascunho NÃO pode gravar movimento');
      }),
    },
  };
  return { tx, estado };
}

const criacao = (extra: Partial<Record<string, unknown>> = {}) => ({
  companyId: COMPANY, depositoOrigemId: 'dep-a', depositoDestinoId: 'dep-b',
  itens: [{ pecaId: 'p-1', quantidade: 4 }],
  autorCompanyUserId: AUTOR, observacao: 'reposição da obra leste', ...extra,
});

describe('criarTransferencia', () => {
  it('nasce rascunho, numerada, com um item por peça', async () => {
    const { tx, estado } = montarCriacao();
    const r = await criarTransferencia(tx as never, criacao({
      itens: [{ pecaId: 'p-1', quantidade: 4 }, { pecaId: 'p-2', quantidade: 2 }],
    }));

    // Numeração: MAX(001, 003) + 1 = 004 — não a contagem de linhas (2 + 1 =
    // 003), que um mutante MAX→contagem também acertaria por acidente.
    expect(r).toMatchObject({ numero: 'TRF-2026-004', itens: 2 });
    expect(estado.transferencias.find((t) => t.id === 'trf-1')).toMatchObject({ status: 'rascunho' });

    // Conteúdo das linhas gravadas, não só a contagem: sem isto, apagar o
    // `createMany` inteiro (zero linhas) ainda passaria, porque `r.itens` é
    // `input.itens.length` — um número que nunca toca o banco.
    expect(estado.itens).toHaveLength(2);
    expect(estado.itens).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ transferenciaId: 'trf-1', pecaId: 'p-1', quantidade: 4 }),
        expect.objectContaining({ transferenciaId: 'trf-1', pecaId: 'p-2', quantidade: 2 }),
      ]),
    );
  });

  it('origem igual ao destino é recusada antes de tocar o banco', async () => {
    const { tx, estado } = montarCriacao();
    await expect(
      criarTransferencia(tx as never, criacao({ depositoDestinoId: 'dep-a' })),
    ).rejects.toThrow(BadRequestException);
    expect(estado.itens).toHaveLength(0);
    expect(tx.deposito.findMany).not.toHaveBeenCalled();
  });

  it('sem item nenhum é recusada', async () => {
    const { tx } = montarCriacao();
    await expect(criarTransferencia(tx as never, criacao({ itens: [] }))).rejects.toThrow(BadRequestException);
  });

  it('quantidade zero ou negativa é recusada', async () => {
    const { tx } = montarCriacao();
    await expect(
      criarTransferencia(tx as never, criacao({ itens: [{ pecaId: 'p-1', quantidade: 0 }] })),
    ).rejects.toThrow(BadRequestException);
    await expect(
      criarTransferencia(tx as never, criacao({ itens: [{ pecaId: 'p-1', quantidade: -5 }] })),
    ).rejects.toThrow(BadRequestException);
  });

  it('quantidade infinita é recusada — "maior que zero" não é de graça com Infinity', async () => {
    // `Math.round(Infinity * 1000) > 0` também é `true`: sem o guard
    // `Number.isFinite`, isto passaria como quantidade válida.
    const { tx } = montarCriacao();
    await expect(
      criarTransferencia(tx as never, criacao({ itens: [{ pecaId: 'p-1', quantidade: Infinity }] })),
    ).rejects.toThrow(BadRequestException);
  });

  it('peça repetida é recusada — some as quantidades numa linha só', async () => {
    const { tx } = montarCriacao();
    await expect(
      criarTransferencia(tx as never, criacao({
        itens: [{ pecaId: 'p-1', quantidade: 2 }, { pecaId: 'p-1', quantidade: 3 }],
      })),
    ).rejects.toThrow(BadRequestException);
  });

  it('peça de outra empresa é recusada, e nada é criado', async () => {
    const { tx, estado } = montarCriacao();
    await expect(
      criarTransferencia(tx as never, criacao({ itens: [{ pecaId: 'p-de-outra-empresa', quantidade: 4 }] })),
    ).rejects.toThrow(BadRequestException);
    expect(estado.itens).toHaveLength(0);
    expect(estado.transferencias.find((t) => t.id === 'trf-1')).toBeUndefined();
  });

  it('depósito de outra empresa não é encontrado', async () => {
    const { tx } = montarCriacao();
    await expect(
      criarTransferencia(tx as never, criacao({ depositoDestinoId: 'dep-outra' })),
    ).rejects.toThrow(NotFoundException);
  });

  it('depósito de destino inativo é recusado', async () => {
    // Pôr mercadoria num depósito que a empresa fechou é criar estoque num
    // lugar que ninguém mais olha.
    const { tx } = montarCriacao();
    await expect(
      criarTransferencia(tx as never, criacao({ depositoDestinoId: 'dep-inativo' })),
    ).rejects.toThrow(BadRequestException);
  });

  it('depósito de origem inativa é ACEITO — é o caminho para esvaziá-lo', async () => {
    // Se a origem também exigisse `ativo`, o estoque de um depósito fechado
    // ficaria preso sem saída nenhuma — a mesma armadilha do inventário que
    // não podia ser cancelado.
    const { tx } = montarCriacao();
    const r = await criarTransferencia(tx as never, criacao({ depositoOrigemId: 'dep-inativo' }));
    expect(r).toMatchObject({ numero: 'TRF-2026-004', itens: 1 });
  });

  it('grava o rastro da criação', async () => {
    const { tx, estado } = montarCriacao();
    await criarTransferencia(tx as never, criacao());
    expect(estado.auditoria).toEqual([
      expect.objectContaining({
        acao: 'transferencia.criar',
        alvoTipo: 'suprimentos.transferencia',
        alvoId: 'trf-1',
        atorId: AUTOR,
      }),
    ]);
  });
});

describe('cancelarTransferencia', () => {
  const cancelamento = (extra: Partial<Record<string, unknown>> = {}) => ({
    companyId: COMPANY, transferenciaId: 'trf-1',
    autorCompanyUserId: AUTOR, motivo: 'pedida por engano', ...extra,
  });

  it('cancela o RASCUNHO, que não moveu saldo nenhum', async () => {
    // Os fakes de `pecaSaldo.update` e `estoqueMovimento.create` (em
    // `montarCriacao`) LANÇAM se forem tocados — é assim que este teste prova
    // a AUSÊNCIA de efeito sobre o estoque, não só o resultado sobre a
    // transferência.
    const { tx, estado } = montarCriacao();
    await criarTransferencia(tx as never, criacao());

    const r = await cancelarTransferencia(tx as never, cancelamento());

    expect(r).toMatchObject({ numero: 'TRF-2026-004' });
    const linha = estado.transferencias.find((t) => t.id === 'trf-1');
    expect(linha).toMatchObject({
      status: 'cancelada',
      motivoCancelamento: 'pedida por engano',
      canceladaPorCompanyUserId: AUTOR,
    });
    expect(linha!.canceladaEm).toBeInstanceOf(Date);
  });

  it('transferência EM TRÂNSITO não cancela — a peça está no caminhão', async () => {
    // Cancelar o que já saiu seria inventar uma volta que ninguém dirigiu. O
    // caminho para carga perdida é confirmar com quantidade recebida zero.
    const { tx, estado } = montarCriacao();
    await criarTransferencia(tx as never, criacao());
    Object.assign(estado.transferencias.find((t) => t.id === 'trf-1')!, { status: 'em_transito' });

    await expect(cancelarTransferencia(tx as never, cancelamento())).rejects.toThrow(ConflictException);
  });

  it('sem motivo não cancela, e não gasta trava', async () => {
    const { tx, estado } = montarCriacao();
    await criarTransferencia(tx as never, criacao());
    await expect(
      cancelarTransferencia(tx as never, cancelamento({ motivo: '  ' })),
    ).rejects.toThrow(BadRequestException);
    expect(estado.log).toEqual([]);
  });

  it('transferência de outra empresa não é encontrada', async () => {
    const { tx } = montarCriacao();
    await criarTransferencia(tx as never, criacao());
    await expect(
      cancelarTransferencia(tx as never, cancelamento({ companyId: '99999999-9999-9999-9999-999999999999' })),
    ).rejects.toThrow(NotFoundException);
  });

  it('trava o cabeçalho ANTES de escrever', async () => {
    // Prova que a trava existe e é tomada antes do UPDATE — não só que ela
    // não quebra o caminho feliz. Sem esta trava, cancelar e expedir (Task 6)
    // concorrentes sobre o mesmo rascunho podiam ler "rascunho" os dois e
    // escrever os dois; se a expedição comitasse por último, a peça sairia
    // da origem sob um documento que o razão diz "cancelado".
    const { tx, estado } = montarCriacao();
    await criarTransferencia(tx as never, criacao());

    await cancelarTransferencia(tx as never, cancelamento());

    expect(estado.log).toContain('trava:transferencia');
    expect(estado.log.indexOf('trava:transferencia')).toBeLessThan(
      estado.log.indexOf('update:transferencia'),
    );
  });

  it('a trava usa o id da transferência e a empresa do pedido, nessa ordem', async () => {
    // Espiona os `values` do `$queryRaw`: prova que o WHERE do FOR UPDATE é
    // escopado por empresa, não só por id — um id certo de OUTRA empresa não
    // pode travar a linha.
    const { tx } = montarCriacao();
    await criarTransferencia(tx as never, criacao());
    await cancelarTransferencia(tx as never, cancelamento());
    expect(tx.$queryRaw).toHaveBeenCalledWith(
      expect.objectContaining({ values: ['trf-1', COMPANY] }),
    );
  });

  it('grava o rastro do cancelamento com motivo, antes e depois', async () => {
    const { tx, estado } = montarCriacao();
    await criarTransferencia(tx as never, criacao());
    await cancelarTransferencia(tx as never, cancelamento());
    expect(estado.auditoria).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          acao: 'transferencia.cancelar',
          alvoTipo: 'suprimentos.transferencia',
          alvoId: 'trf-1',
          atorId: AUTOR,
          motivo: 'pedida por engano',
          antes: expect.objectContaining({ status: 'rascunho' }),
          depois: expect.objectContaining({ status: 'cancelada' }),
        }),
      ]),
    );
  });
});

function montarExpedicao(opts: { status?: string; reservado?: number; itens?: Linha[] } = {}) {
  const log: string[] = [];
  const transferencia: Linha = {
    id: 'trf-1', companyId: COMPANY, numero: 'TRF-2026-001',
    depositoOrigemId: 'dep-a', depositoDestinoId: 'dep-b',
    status: opts.status ?? 'rascunho', expedidaEm: null, expedidaPorCompanyUserId: null,
  };
  // `transferenciaId` tem DEFAULT (`transferencia.id`), mas pode ser
  // sobrescrito por item — é assim que o teste de escopo planta um item de
  // OUTRA transferência dentro da mesma lista fixture.
  const itens: Linha[] = (
    opts.itens ?? [{ id: 'ti-1', pecaId: 'p-1', quantidade: 4, custoUnit: null }]
  ).map((i) => ({ transferenciaId: transferencia.id, ...i }));
  const saldos = new Map<string, Linha>([
    ['p-1|dep-a', { saldoFisico: 10, saldoReservado: opts.reservado ?? 0, custoMedio: 7 }],
    ['p-2|dep-a', { saldoFisico: 6, saldoReservado: 0, custoMedio: 3 }],
  ]);
  const movimentos: Linha[] = [];
  const auditoria: Linha[] = [];
  const estado = { log, transferencia, itens, saldos, movimentos, auditoria };

  const chave = (p: string, d: string) => `${p}|${d}`;

  // Desfazimento: cada escrita empilha como reverter A SI MESMA — mesmo
  // padrão de `inventario.spec.ts` (`gravar`/`criar`/`comoTransacao`). Existe
  // só para o teste de atomicidade poder provar que uma exceção no MEIO do
  // laço de itens desfaz o que um item anterior já tinha gravado — a
  // garantia que um `ROLLBACK` de transação real dá de graça e que estes
  // objetos JS, sozinhos, não dão.
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
      if (q.text.includes('FROM transferencias')) {
        if (!q.text.includes('FOR UPDATE')) {
          throw new Error(`banco falso: SELECT de transferência sem FOR UPDATE — ${q.text}`);
        }
        log.push('trava:transferencia');
        return transferencia.id === q.values[0] && transferencia.companyId === q.values[1]
          ? [{ id: 'trf-1' }]
          : [];
      }
      if (q.text.includes('FROM peca_saldos')) {
        if (!q.text.includes('FOR UPDATE')) {
          throw new Error(`banco falso: SELECT de saldo sem FOR UPDATE — ${q.text}`);
        }
        const [pecaId, depositoId] = q.values as [string, string];
        log.push(`trava:saldo:${pecaId}|${depositoId}`);
        return saldos.has(chave(pecaId, depositoId)) ? [{ peca_id: pecaId }] : [];
      }
      throw new Error(`banco falso: SQL não reconhecido — ${q.text}`);
    }),
    transferencia: {
      findFirst: jest.fn(async ({ where }: { where: { id: string; companyId: string } }) => {
        if (!where.companyId) throw new Error('banco falso: findFirst sem escopo de empresa.');
        return where.id === transferencia.id && where.companyId === transferencia.companyId
          ? { ...transferencia }
          : null;
      }),
      update: jest.fn(async ({ where, data }: { where: { id: string }; data: Linha }) => {
        // Confere o `where.id`, não só a presença da chamada — mesma dureza
        // de `inventario.spec.ts` (`inventario.update`), para que um `id`
        // errado não seja silenciosamente aceito.
        if (where.id !== transferencia.id) throw new Error('P2025');
        gravar(transferencia, data);
        log.push('update:transferencia');
        return {};
      }),
    },
    transferenciaItem: {
      findMany: jest.fn(async ({ where }: { where: { transferenciaId?: string } }) => {
        if (!where.transferenciaId) {
          throw new Error('banco falso: transferenciaItem.findMany sem escopo de transferência.');
        }
        // Filtra pelo VALOR do `where.transferenciaId` — não devolve a lista
        // inteira sem olhar o filtro. É o que prova que um item de OUTRA
        // transferência plantado na mesma fixture não vaza para cá.
        return itens
          .filter((i) => i.transferenciaId === where.transferenciaId)
          .map((i) => ({ ...i, peca: { codigoInterno: `ALM-${i.pecaId}` } }));
      }),
      update: jest.fn(async ({ where, data }: { where: { id: string }; data: Linha }) => {
        const item = itens.find((i) => i.id === where.id);
        if (!item) throw new Error('P2025');
        gravar(item, data);
        return {};
      }),
    },
    pecaSaldo: {
      // SEM `upsert`: expedir NUNCA cria linha de saldo. Devolve `null`
      // quando a origem não tem a peça — como o Prisma real devolveria de
      // `findUnique` — ao contrário de `findUniqueOrThrow`, que estouraria
      // P2025 cru se a produção ainda o chamasse.
      findUnique: jest.fn(
        async ({ where }: { where: { pecaId_depositoId: { pecaId: string; depositoId: string } } }) => {
          const k = where.pecaId_depositoId;
          // Empilha DEPOIS da trava correspondente (`trava:saldo:...`) — é
          // o que o teste de ordem lê para provar que a leitura não foi
          // içada para antes do `FOR UPDATE`.
          log.push(`ler:saldo:${k.pecaId}|${k.depositoId}`);
          const linha = saldos.get(chave(k.pecaId, k.depositoId));
          return linha ? { ...linha } : null;
        },
      ),
      update: jest.fn(
        async ({ where, data }: { where: { pecaId_depositoId: { pecaId: string; depositoId: string } }; data: Linha }) => {
          const k = where.pecaId_depositoId;
          const linha = saldos.get(chave(k.pecaId, k.depositoId));
          if (!linha) throw new Error('P2025');
          gravar(linha, data);
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

  // Roda `fn` (a chamada de `expedirTransferencia`) como se fosse a
  // transação real: se `fn` lança, desfaz TUDO que o `tx` já tinha gravado,
  // na ordem inversa — o `ROLLBACK` que o `$transaction` do chamador dá de
  // graça e que este fake, sozinho, não dá.
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

const expedicao = (extra: Partial<Record<string, unknown>> = {}) => ({
  companyId: COMPANY, transferenciaId: 'trf-1', autorCompanyUserId: AUTOR, ...extra,
});

describe('expedirTransferencia', () => {
  it('a quantidade sai do físico da ORIGEM e vira movimento negativo', async () => {
    const { tx, estado } = montarExpedicao();

    const r = await expedirTransferencia(tx as never, expedicao());

    expect(r).toMatchObject({ numero: 'TRF-2026-001', itens: 1 });
    expect(estado.saldos.get('p-1|dep-a')!.saldoFisico).toBe(6);
    expect(estado.movimentos).toEqual([
      expect.objectContaining({
        pecaId: 'p-1', depositoId: 'dep-a', tipo: 'transferencia',
        quantidade: -4, saldoApos: 6, custoUnit: 7,
        origemTipo: 'transferencia', origemId: 'trf-1',
        // A observação carrega o número do documento — apagar essa linha da
        // produção não muda saldo nem quantidade, e sem esta asserção
        // passaria despercebido.
        observacao: 'TRF-2026-001',
      }),
    ]);
  });

  it('a quantidade NÃO entra no destino ainda — ela está no caminhão', async () => {
    // O §5.4 em uma asserção: entre sair e chegar, a peça não está em
    // `peca_saldos` nenhum. O destino nem tem linha tocada.
    const { tx, estado } = montarExpedicao();
    await expedirTransferencia(tx as never, expedicao());
    expect(estado.saldos.has('p-1|dep-b')).toBe(false);
    expect(estado.movimentos).toHaveLength(1);
  });

  it('congela o custo da origem no item — a média de lá pode mudar no caminho', async () => {
    const { tx, estado } = montarExpedicao();
    await expedirTransferencia(tx as never, expedicao());
    expect(estado.itens[0].custoUnit).toBe(7);
  });

  it('a média da ORIGEM não muda: saiu quantidade, não saiu valor unitário', async () => {
    const { tx, estado } = montarExpedicao();
    await expedirTransferencia(tx as never, expedicao());
    expect(estado.saldos.get('p-1|dep-a')!.custoMedio).toBe(7);
  });

  it('lê o saldo DEPOIS de travar a linha — a escrita é absoluta, não um decrement', async () => {
    // Sem esta ordem, duas expedições concorrentes da mesma peça leriam o
    // mesmo físico e a segunda sobrescreveria a baixa da primeira
    // (lost update) — içar a leitura para antes do `FOR UPDATE` deixaria a
    // suíte inteira verde do mesmo jeito, então só esta asserção de ORDEM
    // pega essa regressão.
    const { tx, estado } = montarExpedicao();
    await expedirTransferencia(tx as never, expedicao());
    expect(estado.log.indexOf('trava:saldo:p-1|dep-a')).toBeLessThan(
      estado.log.indexOf('ler:saldo:p-1|dep-a'),
    );
  });

  it('peça sem saldo na origem recusa nomeando a peça, não estoura erro cru', async () => {
    // Alcançável de verdade: `criarTransferencia` só garante que a peça
    // existe e está ATIVA na empresa, nunca que ela tem saldo no depósito de
    // ORIGEM. Uma peça estocada só no depósito B, posta num rascunho A→B,
    // chega aqui sem linha nenhuma de `peca_saldos` em A.
    const { tx, estado } = montarExpedicao({
      itens: [{ id: 'ti-1', pecaId: 'p-sem-saldo', quantidade: 1, custoUnit: null }],
    });
    await expect(expedirTransferencia(tx as never, expedicao())).rejects.toThrow(NotFoundException);
    await expect(expedirTransferencia(tx as never, expedicao())).rejects.toThrow(/ALM-p-sem-saldo/);
    expect(estado.movimentos).toHaveLength(0);
  });

  it('o que está reservado não viaja, e nada é gravado', async () => {
    const { tx, estado } = montarExpedicao({ reservado: 8 });
    await expect(expedirTransferencia(tx as never, expedicao())).rejects.toThrow(ConflictException);
    expect(estado.movimentos).toHaveLength(0);
    expect(estado.transferencia.status).toBe('rascunho');
  });

  it('a recusa por reserva identifica a peça', async () => {
    const { tx } = montarExpedicao({ reservado: 8 });
    await expect(expedirTransferencia(tx as never, expedicao())).rejects.toThrow(/ALM-p-1/);
  });

  it('recusa no SEGUNDO item desfaz o que o primeiro já tinha gravado', async () => {
    // `p-1` (travado primeiro, por `compararPorPeca`) baixa sem problema; é
    // `p-2` que esbarra no reservado. Isto prova que a função não segue em
    // frente fechando a expedição com o que deu certo: a exceção propaga, a
    // transferência não muda de status, e o que `p-1` já tinha gravado não
    // sobrevive — a mesma garantia que, numa transação real, o `ROLLBACK` do
    // `$transaction` do chamador dá; `comoTransacao` simula esse `ROLLBACK`
    // aqui, no molde de `inventario.spec.ts`.
    const { tx, estado, comoTransacao } = montarExpedicao({
      itens: [
        { id: 'ti-1', pecaId: 'p-1', quantidade: 4, custoUnit: null },
        { id: 'ti-2', pecaId: 'p-2', quantidade: 1, custoUnit: null },
      ],
    });
    estado.saldos.get('p-2|dep-a')!.saldoReservado = 6; // físico 6, reservado 6: nada livre.

    let capturado: unknown;
    try {
      await comoTransacao(() => expedirTransferencia(tx as never, expedicao()));
    } catch (erro) {
      capturado = erro;
    }
    expect(capturado).toBeInstanceOf(ConflictException);
    expect((capturado as Error).message).toMatch(/ALM-p-2/);

    expect(estado.movimentos).toHaveLength(0);
    expect(estado.itens[0].custoUnit).toBeNull();
    expect(estado.saldos.get('p-1|dep-a')!.saldoFisico).toBe(10);
    expect(estado.transferencia.status).toBe('rascunho');
  });

  it('trava a transferência e depois os saldos, na ordem do comparador', async () => {
    const { tx, estado } = montarExpedicao({
      itens: [
        { id: 'ti-2', pecaId: 'p-2', quantidade: 1, custoUnit: null },
        { id: 'ti-1', pecaId: 'p-1', quantidade: 4, custoUnit: null },
      ],
    });
    await expedirTransferencia(tx as never, expedicao());
    const travas = estado.log.filter((l) => l.startsWith('trava:'));
    expect(travas[0]).toBe('trava:transferencia');
    const saldos = travas.slice(1);
    expect(saldos).toEqual([...saldos].sort());
  });

  it('lê só os itens desta transferência, não os de outra plantados na mesma fixture', async () => {
    const { tx, estado } = montarExpedicao({
      itens: [
        { id: 'ti-1', pecaId: 'p-1', quantidade: 4, custoUnit: null },
        { id: 'ti-outra', transferenciaId: 'trf-outra', pecaId: 'p-2', quantidade: 1, custoUnit: null },
      ],
    });
    const r = await expedirTransferencia(tx as never, expedicao());
    expect(r.itens).toBe(1);
    // A peça e o item da OUTRA transferência não foram tocados.
    expect(estado.saldos.get('p-2|dep-a')!.saldoFisico).toBe(6);
    expect(estado.itens.find((i) => i.id === 'ti-outra')!.custoUnit).toBeNull();
  });

  it('sem item nenhum não expede', async () => {
    const { tx } = montarExpedicao({ itens: [] });
    await expect(expedirTransferencia(tx as never, expedicao())).rejects.toThrow(BadRequestException);
  });

  it.each(['em_transito', 'recebida', 'cancelada'])(
    'transferência %s não expede de novo',
    async (status) => {
      const { tx } = montarExpedicao({ status });
      await expect(expedirTransferencia(tx as never, expedicao())).rejects.toThrow(ConflictException);
    },
  );

  it('transferência de outra empresa não é encontrada', async () => {
    const { tx } = montarExpedicao();
    await expect(
      expedirTransferencia(tx as never, expedicao({ companyId: OUTRA })),
    ).rejects.toThrow(NotFoundException);
  });

  it('transferência inexistente não é encontrada', async () => {
    const { tx } = montarExpedicao();
    await expect(
      expedirTransferencia(tx as never, expedicao({ transferenciaId: 'trf-fantasma' })),
    ).rejects.toThrow(NotFoundException);
  });

  it('fecha como em_transito, com quem expediu e quando', async () => {
    const { tx, estado } = montarExpedicao();
    await expedirTransferencia(tx as never, expedicao());
    expect(estado.transferencia).toMatchObject({
      status: 'em_transito', expedidaPorCompanyUserId: AUTOR,
    });
    expect(estado.transferencia.expedidaEm).toBeInstanceOf(Date);
  });

  it('grava o rastro da expedição, com QUEM expediu', async () => {
    const { tx, estado } = montarExpedicao();
    await expedirTransferencia(tx as never, expedicao());
    expect(estado.auditoria).toEqual([
      expect.objectContaining({
        acao: 'transferencia.expedir',
        alvoTipo: 'suprimentos.transferencia',
        alvoId: 'trf-1',
        // Trocar `atorCompanyUserId` por um UUID fixo na produção passaria
        // verde sem esta asserção — o teste irmão de `cancelarTransferencia`
        // já afirma o mesmo campo.
        atorId: AUTOR,
      }),
    ]);
  });
});
