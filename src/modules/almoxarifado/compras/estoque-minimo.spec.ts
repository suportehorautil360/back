import { Logger } from '@nestjs/common';
import { Prisma } from '../../../prisma/generated/client';
import { varrerEstoqueMinimo, verificarReposicao, verificarReposicoesSemFalhar } from './estoque-minimo';

const COMPANY = '11111111-1111-1111-1111-111111111111';
const TERCEIRA = '33333333-3333-3333-3333-333333333333';
const OUTRA = '99999999-9999-9999-9999-999999999999';
const ANO = new Date().getUTCFullYear();
const INDICE = 'solicitacao_compra_itens_uma_reposicao_automatica';

type Linha = Record<string, any>;

/**
 * O P2002 como o Prisma 7 com `@prisma/adapter-pg` o entrega (conferido contra
 * o runtime instalado): sem `meta.target`, com os campos na causa do driver.
 */
function erroDeUnique(indice: string, campos: string[]): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError(`Unique constraint failed on the fields: (${campos.join(', ')})`, {
    code: 'P2002',
    clientVersion: '7.9.1',
    meta: {
      modelName: 'SolicitacaoCompra',
      driverAdapterError: {
        name: 'DriverAdapterError',
        cause: {
          originalCode: '23505',
          originalMessage: `duplicate key value violates unique constraint "${indice}"`,
          kind: 'UniqueConstraintViolation',
          constraint: { fields: campos },
        },
      },
    },
  });
}

/** Deadlock/serialização como o adapter os entrega: `P2010` (raw) ou `P2039` (modelo), sem `meta.code`. */
function erroDeContencao(code: 'P2010' | 'P2039', sqlstate: '40P01' | '40001'): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError(`Database error. Code: \`${sqlstate}\``, {
    code,
    clientVersion: '7.9.1',
    meta: {
      driverAdapterError: {
        name: 'DriverAdapterError',
        cause: { originalCode: sqlstate, originalMessage: 'contenção simulada', kind: 'postgres', code: sqlstate },
      },
    },
  });
}

const naoReconhecido = (onde: string, detalhe: unknown): never => {
  throw new Error(`${onde}: não reconhecido neste fake — ${JSON.stringify(detalhe)}`);
};

function exigirChaves(onde: string, obj: Linha, permitidas: string[]): void {
  for (const k of Object.keys(obj)) if (!permitidas.includes(k)) naoReconhecido(`${onde}.${k}`, obj);
}

function casaEscalar(valor: unknown, filtro: unknown, onde: string): boolean {
  if (filtro === null || typeof filtro !== 'object') return valor === filtro;
  const f = filtro as Linha;
  exigirChaves(onde, f, ['in', 'notIn', 'not', 'gt', 'startsWith']);
  if ('in' in f && !f.in.includes(valor)) return false;
  if ('notIn' in f && f.notIn.includes(valor)) return false;
  if ('not' in f && valor === f.not) return false;
  if ('gt' in f && !(Number(valor) > Number(f.gt))) return false;
  if ('startsWith' in f && !String(valor).startsWith(f.startsWith)) return false;
  return true;
}

/**
 * Aplica um `where` do Prisma a uma linha. Chave ausente não filtra (é o que o
 * Prisma faz); chave que o fake não conhece lança — um teste nunca passa por
 * um filtro que o fake ignorou.
 */
function filtrar(
  onde: string,
  linha: Linha,
  where: Linha,
  escalares: string[],
  relacoes: Record<string, (linha: Linha, sub: Linha) => boolean> = {},
): boolean {
  exigirChaves(onde, where, [...escalares, ...Object.keys(relacoes)]);
  for (const [k, v] of Object.entries(where)) {
    if (v === undefined) continue;
    if (k in relacoes) {
      if (!relacoes[k](linha, v)) return false;
    } else if (!casaEscalar(linha[k], v, `${onde}.${k}`)) {
      return false;
    }
  }
  return true;
}

function ordenar(onde: string, lista: Linha[], orderBy: unknown, permitidos: string[]): Linha[] {
  const criterios = (Array.isArray(orderBy) ? orderBy : [orderBy]).flatMap((c: Linha) => Object.entries(c));
  for (const [campo, dir] of criterios) {
    if (!permitidos.includes(campo) || (dir !== 'asc' && dir !== 'desc')) naoReconhecido(`${onde}.orderBy`, orderBy);
  }
  const valor = (v: unknown) => (v instanceof Date ? v.getTime() : v) as number | string;
  return [...lista].sort((a, b) => {
    for (const [campo, dir] of criterios) {
      const va = valor(a[campo]);
      const vb = valor(b[campo]);
      if (va !== vb) return (va < vb ? -1 : 1) * (dir === 'asc' ? 1 : -1);
    }
    return 0;
  });
}

function conferirChecksDeSaldo(s: Linha): void {
  if (s.saldoFisico < 0) throw new Error('CHECK peca_saldos: saldo_fisico >= 0');
  if (s.saldoReservado < 0 || s.saldoReservado > s.saldoFisico) throw new Error('CHECK peca_saldos: 0 <= reservado <= fisico');
  if (s.saldoEmCompra < 0) throw new Error('CHECK peca_saldos: em_compra >= 0');
}

const saldo = (pecaId: string, depositoId: string, saldoFisico = 0, saldoReservado = 0): Linha => ({
  pecaId, depositoId, saldoFisico, saldoReservado, saldoSeparado: 0, saldoEmCompra: 0, localizacao: null,
});
const usuario = (id: string, companyId: string, role: string, status: string, criadoEm: string): Linha => ({
  id, companyId, role, status, createdAt: new Date(criadoEm), name: id, email: `${id}@x.com`,
});

const ORIGENS = ['falta_os', 'peca_adicional', 'estoque_minimo', 'manual'];
const STATUS_SC = ['pendente', 'em_cotacao', 'aprovada', 'rejeitada', 'cancelada'];
const PRIORIDADES = ['critica', 'alta', 'normal', 'reposicao'];
const STATUS_ITEM = ['aberta', 'atendida', 'cancelada'];
const CAMPOS_SC = [
  'companyId', 'numero', 'origem', 'status', 'prioridade', 'depositoId', 'serviceOrderId', 'requisicaoId',
  'justificativa', 'solicitanteCompanyUserId', 'emNomeDeCompanyUserId',
];
const CAMPOS_ITEM = ['pecaId', 'quantidade', 'requisicaoItemId', 'prioridade', 'dataNecessidade', 'status', 'depositoReposicaoId'];

/**
 * Banco fake que PERSISTE e FILTRA pelos `where` que a produção usa, desfaz a
 * transação que lança (como o Postgres), e reproduz o que o INSERT da
 * solicitação pode violar: o unique de `(company_id, numero)`, o índice único
 * parcial da reposição automática, as CHECKs de origem/status/prioridade e de
 * quantidade positiva, e as FKs de peça e depósito. As CHECKs de `peca_saldos`
 * são conferidas a cada leitura, para nenhum cenário montar um saldo que o
 * banco recusaria. Não há como criar linha de saldo por aqui.
 */
function montarBanco() {
  const log: string[] = [];
  const features = new Map<string, Linha>([
    ['f-sup', { id: 'f-sup', key: 'suprimentos' }],
    ['f-mec', { id: 'f-mec', key: 'mecanica' }],
  ]);
  const companyFeatures: Linha[] = [{ companyId: COMPANY, featureId: 'f-sup', enabled: true }];
  const depositos = new Map<string, Linha>([
    ['dep-1', { id: 'dep-1', companyId: COMPANY, ativo: true }],
    ['dep-2', { id: 'dep-2', companyId: COMPANY, ativo: true }],
  ]);
  const pecas = new Map<string, Linha>([
    ['p-1', { id: 'p-1', companyId: COMPANY, codigoInterno: 'ALM-000001', ativo: true, estoqueMinimo: 10, loteReposicao: 0 }],
  ]);
  const saldos = new Map<string, Linha>([['p-1|dep-1', saldo('p-1', 'dep-1')]]);
  const scs = new Map<string, Linha>();
  const scItens = new Map<string, Linha>();
  const origens = new Map<string, Linha>();
  const settings = new Map<string, Linha>([[COMPANY, { companyId: COMPANY, gestorMasterCompanyUserId: 'cu-gestor' }]]);
  // Inserção fora da ordem de criação: sem `orderBy`, o primeiro OWNER achado seria o mais novo.
  const usuarios = new Map<string, Linha>(
    [
      usuario('cu-owner-novo', COMPANY, 'OWNER', 'ACTIVE', '2026-03-01'),
      usuario('cu-gestor', COMPANY, 'MEMBER', 'ACTIVE', '2026-02-01'),
      usuario('cu-gestor-inativo', COMPANY, 'MEMBER', 'INACTIVE', '2026-01-01'),
      usuario('cu-owner-antigo', COMPANY, 'OWNER', 'ACTIVE', '2025-01-10'),
      usuario('cu-owner-inativo', COMPANY, 'OWNER', 'INACTIVE', '2024-01-10'),
      usuario('cu-admin', COMPANY, 'ADMIN', 'ACTIVE', '2023-01-10'),
      usuario('cu-owner-outra', OUTRA, 'OWNER', 'ACTIVE', '2020-01-10'),
    ].map((u) => [u.id, u]),
  );
  const auditoria: Linha[] = [];
  const violacoesDoIndice: string[] = [];
  const ganchos: {
    /** Roda quando a linha de saldo é travada: quem commitou antes de a trava ser concedida. */
    aoTravarSaldo?: (e: Estado, chave: string) => void;
    /** Roda UMA vez, antes do INSERT da solicitação: quem commitou entre a checagem e o INSERT. */
    antesDoInsert?: (e: Estado) => void;
    /** Roda na listagem de pares da varredura. */
    aoListarPares?: (where: Linha) => void;
  } = {};

  let seq = 0;
  let pilhaDeDesfazer: (() => void)[] | null = null;
  const aoDesfazer = (fn: () => void) => pilhaDeDesfazer?.push(fn);

  /** INSERT da solicitação com os itens — tudo ou nada. */
  function inserirSolicitacao(data: Linha, itens: Linha[], desfazivel: boolean) {
    exigirChaves('solicitacaoCompra.create.data', data, CAMPOS_SC);
    const sc: Linha = {
      id: `sc-${++seq}`, status: 'pendente', serviceOrderId: null, requisicaoId: null, justificativa: null,
      solicitanteCompanyUserId: null, emNomeDeCompanyUserId: null, ...data,
    };
    if (!ORIGENS.includes(sc.origem)) throw new Error('CHECK solicitacoes_compra_origem_conhecida');
    if (!STATUS_SC.includes(sc.status)) throw new Error('CHECK solicitacoes_compra_status_conhecido');
    if (!PRIORIDADES.includes(sc.prioridade)) throw new Error('CHECK solicitacoes_compra_prioridade_conhecida');
    if (!depositos.has(sc.depositoId)) throw new Error('FK solicitacoes_compra.deposito_id');
    if ([...scs.values()].some((o) => o.companyId === sc.companyId && o.numero === sc.numero)) {
      throw erroDeUnique('solicitacoes_compra_numero', ['company_id', 'numero']);
    }
    const novos = itens.map((i) => {
      exigirChaves('solicitacaoCompra.create.data.itens.create', i, CAMPOS_ITEM);
      const item: Linha = {
        id: `sci-${++seq}`, solicitacaoId: sc.id, requisicaoItemId: null, dataNecessidade: null, status: 'aberta',
        depositoReposicaoId: null, ...i,
      };
      if (!(Number(item.quantidade) > 0)) throw new Error('CHECK sc_item_quantidade_positiva');
      if (!PRIORIDADES.includes(item.prioridade)) throw new Error('CHECK sc_item_prioridade_conhecida');
      if (!STATUS_ITEM.includes(item.status)) throw new Error('CHECK sc_item_status_conhecido');
      if (!pecas.has(item.pecaId)) throw new Error('FK solicitacao_compra_itens.peca_id');
      if (item.depositoReposicaoId !== null && !depositos.has(item.depositoReposicaoId)) {
        throw new Error('FK solicitacao_compra_itens.deposito_reposicao_id');
      }
      return item;
    });
    for (const item of novos) {
      if (item.depositoReposicaoId === null || item.status !== 'aberta') continue;
      const colide = [...scItens.values()].some(
        (o) => o.pecaId === item.pecaId && o.depositoReposicaoId === item.depositoReposicaoId && o.status === 'aberta',
      );
      if (colide) {
        violacoesDoIndice.push(`${item.pecaId}|${item.depositoReposicaoId}`);
        throw erroDeUnique(INDICE, ['peca_id', 'deposito_reposicao_id']);
      }
    }
    scs.set(sc.id, sc);
    for (const item of novos) scItens.set(item.id, item);
    if (desfazivel) {
      aoDesfazer(() => {
        scs.delete(sc.id);
        for (const item of novos) scItens.delete(item.id);
      });
    }
    return { sc, itens: novos };
  }

  /** Solicitação que já existia (ou que outra transação commitou): não é desfeita. */
  function plantarSolicitacao(
    cabecalho: Linha,
    itens: (Linha & { quantidade: number; recebido?: number[] })[],
  ): { sc: Linha; itens: Linha[] } {
    const r = inserirSolicitacao(
      {
        companyId: COMPANY, depositoId: 'dep-1', origem: 'manual', prioridade: 'normal', numero: `SC-${ANO - 1}-${900 + seq}`,
        ...cabecalho,
      },
      itens.map(({ recebido: _recebido, ...i }) => ({ pecaId: 'p-1', prioridade: 'normal', ...i })),
      false,
    );
    r.itens.forEach((item, idx) => {
      (itens[idx].recebido ?? []).forEach((recebido, k) => {
        const id = `${item.id}-o${k}`;
        origens.set(id, { id, solicitacaoCompraItemId: item.id, quantidade: recebido, quantidadeRecebida: recebido });
      });
    });
    return r;
  }

  const itensQueCasam = (where: Linha) =>
    [...scItens.values()]
      .filter((i) =>
        filtrar('solicitacaoCompraItem', i, where, ['pecaId', 'depositoReposicaoId', 'requisicaoItemId', 'status'], {
          solicitacao: (l, sub) =>
            filtrar('solicitacaoCompraItem.solicitacao', scs.get(l.solicitacaoId)!, sub, ['companyId', 'depositoId', 'status']),
        }),
      )
      .map((i) => ({
        ...i,
        origensOc: [...origens.values()].filter((o) => o.solicitacaoCompraItemId === i.id).map((o) => ({ ...o })),
      }));

  const featuresQueCasam = (where: Linha) =>
    companyFeatures.filter((cf) =>
      filtrar('companyFeature', cf, where, ['companyId', 'enabled'], {
        feature: (l, sub) => filtrar('companyFeature.feature', features.get(l.featureId)!, sub, ['key']),
      }),
    );

  const tx = {
    $queryRaw: jest.fn(async (q: { text: string; values: unknown[] }) => {
      if (!/FROM peca_saldos/.test(q.text) || !/peca_id = /.test(q.text) || !/deposito_id = /.test(q.text) || q.values.length !== 2) {
        return naoReconhecido('$queryRaw', q.text);
      }
      const [pecaId, depositoId] = q.values as [string, string];
      const chave = `${pecaId}|${depositoId}`;
      if (/FOR UPDATE/.test(q.text)) {
        log.push(`trava:${depositoId}|${pecaId}`);
        ganchos.aoTravarSaldo?.(estado, chave);
      }
      const s = saldos.get(chave);
      if (s) conferirChecksDeSaldo(s);
      return s ? [{ peca_id: pecaId }] : [];
    }),
    companyFeature: {
      findFirst: jest.fn(async ({ where }: { where: Linha }) => {
        const cf = featuresQueCasam(where)[0];
        return cf ? { ...cf } : null;
      }),
    },
    deposito: {
      findFirst: jest.fn(async ({ where }: { where: Linha }) => {
        const d = [...depositos.values()].find((x) => filtrar('deposito', x, where, ['id', 'companyId', 'ativo']));
        return d ? { ...d } : null;
      }),
    },
    pecaSaldo: {
      findUniqueOrThrow: jest.fn(async ({ where }: { where: Linha }) => {
        exigirChaves('pecaSaldo.findUniqueOrThrow', where, ['pecaId_depositoId']);
        const s = saldos.get(`${where.pecaId_depositoId.pecaId}|${where.pecaId_depositoId.depositoId}`);
        if (!s) throw new Error('P2025: No PecaSaldo found');
        conferirChecksDeSaldo(s);
        return { ...s };
      }),
    },
    peca: {
      findFirst: jest.fn(async ({ where }: { where: Linha }) => {
        const p = [...pecas.values()].find((x) => filtrar('peca', x, where, ['id', 'companyId']));
        return p ? { ...p } : null;
      }),
    },
    solicitacaoCompraItem: {
      findFirst: jest.fn(async ({ where }: { where: Linha }) => itensQueCasam(where)[0] ?? null),
      findMany: jest.fn(async ({ where }: { where: Linha }) => itensQueCasam(where)),
    },
    companySettings: {
      findUnique: jest.fn(async ({ where }: { where: Linha }) => {
        exigirChaves('companySettings.findUnique', where, ['companyId']);
        const s = settings.get(where.companyId);
        return s ? { ...s } : null;
      }),
    },
    companyUser: {
      findFirst: jest.fn(async ({ where, orderBy }: { where: Linha; orderBy?: unknown }) => {
        // Como o Prisma: `id` não é nulável, e filtrar por `id: null` é erro de validação, não "nenhum".
        if ('id' in where && where.id === null) throw new Error('PrismaClientValidationError: Argument `id` must not be null.');
        let lista = [...usuarios.values()].filter((u) => filtrar('companyUser', u, where, ['id', 'companyId', 'role', 'status']));
        if (orderBy !== undefined) lista = ordenar('companyUser', lista, orderBy, ['createdAt', 'id']);
        return lista[0] ? { ...lista[0] } : null;
      }),
    },
    solicitacaoCompra: {
      findMany: jest.fn(async ({ where }: { where: Linha }) =>
        [...scs.values()].filter((s) => filtrar('solicitacaoCompra', s, where, ['companyId', 'numero'])).map((s) => ({ ...s })),
      ),
      create: jest.fn(async ({ data }: { data: Linha }) => {
        const gancho = ganchos.antesDoInsert;
        ganchos.antesDoInsert = undefined;
        gancho?.(estado);
        const { itens, ...cabecalho } = data;
        exigirChaves('solicitacaoCompra.create.data.itens', itens ?? {}, ['create']);
        const lista = itens?.create === undefined ? [] : Array.isArray(itens.create) ? itens.create : [itens.create];
        const { sc } = inserirSolicitacao(cabecalho, lista, true);
        return { id: sc.id, numero: sc.numero };
      }),
    },
    pontoAuditoria: {
      create: jest.fn(async ({ data }: { data: Linha }) => {
        const linha = { ...data };
        auditoria.push(linha);
        aoDesfazer(() => auditoria.splice(auditoria.indexOf(linha), 1));
        return linha;
      }),
    },
  };

  const prisma = {
    $transaction: jest.fn(async (fn: (t: typeof tx) => Promise<unknown>) => {
      if (pilhaDeDesfazer) throw new Error('transação aninhada — não existe no Prisma');
      const pilha: (() => void)[] = [];
      pilhaDeDesfazer = pilha;
      try {
        return await fn(tx);
      } catch (erro) {
        for (const desfazer of pilha.reverse()) desfazer();
        throw erro;
      } finally {
        pilhaDeDesfazer = null;
      }
    }),
    companyFeature: {
      findMany: jest.fn(async ({ where }: { where: Linha }) => featuresQueCasam(where).map((cf) => ({ ...cf }))),
    },
    pecaSaldo: {
      findMany: jest.fn(async ({ where }: { where: Linha }) => {
        ganchos.aoListarPares?.(where);
        return [...saldos.values()]
          .filter((s) =>
            filtrar('pecaSaldo.findMany', s, where, ['pecaId', 'depositoId'], {
              peca: (l, sub) => filtrar('pecaSaldo.peca', pecas.get(l.pecaId)!, sub, ['companyId', 'ativo', 'estoqueMinimo']),
              deposito: (l, sub) => filtrar('pecaSaldo.deposito', depositos.get(l.depositoId)!, sub, ['companyId', 'ativo']),
            }),
          )
          .map((s) => ({ pecaId: s.pecaId, depositoId: s.depositoId }));
      }),
    },
  };

  const estado = {
    log, features, companyFeatures, depositos, pecas, saldos, scs, scItens, origens, settings, usuarios, auditoria,
    violacoesDoIndice, ganchos,
  };
  return { prisma, tx, estado, plantarSolicitacao };
}

type Estado = ReturnType<typeof montarBanco>['estado'];

const alvo = (pecaId = 'p-1', depositoId = 'dep-1', companyId = COMPANY) => ({ companyId, pecaId, depositoId });

/** As solicitações automáticas gravadas, com o item — o que Compras vai ver. */
function automaticas(e: Estado): (Linha & { itens: Linha[] })[] {
  return [...e.scs.values()]
    .filter((s) => s.origem === 'estoque_minimo')
    .map((s) => ({ ...s, itens: [...e.scItens.values()].filter((i) => i.solicitacaoId === s.id) }));
}

describe('verificarReposicao — o que fica gravado', () => {
  it('abaixo do mínimo com lote: SC automática em nome do gestor master, item de reposição do depósito e rastro do Sistema', async () => {
    const b = montarBanco();
    Object.assign(b.estado.pecas.get('p-1')!, { estoqueMinimo: 10, loteReposicao: 25 });
    Object.assign(b.estado.saldos.get('p-1|dep-1')!, { saldoFisico: 3, saldoReservado: 3 });
    // O número é por empresa: o da outra não conta.
    b.plantarSolicitacao({ companyId: OUTRA, numero: `SC-${ANO}-007` }, []);

    const r = await verificarReposicao(b.prisma as never, alvo());

    expect(r).toEqual({ solicitacaoId: expect.any(String), numero: `SC-${ANO}-001` });
    expect(automaticas(b.estado)).toEqual([
      {
        id: r!.solicitacaoId,
        companyId: COMPANY,
        numero: `SC-${ANO}-001`,
        origem: 'estoque_minimo',
        status: 'pendente',
        prioridade: 'reposicao',
        depositoId: 'dep-1',
        serviceOrderId: null,
        requisicaoId: null,
        justificativa: 'Reposição automática: disponível 0 + a caminho 0 abaixo do mínimo 10.',
        solicitanteCompanyUserId: null,
        emNomeDeCompanyUserId: 'cu-gestor',
        itens: [
          {
            id: expect.any(String),
            solicitacaoId: r!.solicitacaoId,
            pecaId: 'p-1',
            quantidade: 25,
            requisicaoItemId: null,
            prioridade: 'reposicao',
            dataNecessidade: null,
            status: 'aberta',
            depositoReposicaoId: 'dep-1',
          },
        ],
      },
    ]);
    expect(b.estado.auditoria).toEqual([
      {
        companyId: COMPANY,
        acao: 'solicitacao_compra.criar_automatica',
        alvoTipo: 'suprimentos.solicitacao_compra',
        alvoId: r!.solicitacaoId,
        atorId: null,
        atorNome: 'Sistema',
        atorEmail: '',
        motivo: null,
        depois: {
          numero: `SC-${ANO}-001`,
          pecaId: 'p-1',
          codigoInterno: 'ALM-000001',
          depositoId: 'dep-1',
          disponivel: 0,
          aCaminho: 0,
          posicao: 0,
          minimo: 10,
          quantidade: 25,
          emNomeDeCompanyUserId: 'cu-gestor',
        },
      },
    ]);
    // Verificar não mexe no saldo.
    expect(b.estado.saldos.get('p-1|dep-1')).toEqual(saldo('p-1', 'dep-1', 3, 3));
  });

  it('sem lote: pede o que falta para a posição voltar ao mínimo', async () => {
    const b = montarBanco();
    Object.assign(b.estado.saldos.get('p-1|dep-1')!, { saldoFisico: 4, saldoReservado: 1 });

    await verificarReposicao(b.prisma as never, alvo());

    const [sc] = automaticas(b.estado);
    expect(sc.justificativa).toBe('Reposição automática: disponível 3 + a caminho 0 abaixo do mínimo 10.');
    expect(sc.itens.map((i) => i.quantidade)).toEqual([7]);
  });

  it('reposição pedida e parcialmente recebida conta só o que falta chegar', async () => {
    const b = montarBanco();
    // Pedido de 8 que já entregou 5 — os 5 estão no físico.
    b.plantarSolicitacao({ origem: 'manual', status: 'aprovada' }, [{ quantidade: 8, recebido: [2, 3] }]);
    Object.assign(b.estado.saldos.get('p-1|dep-1')!, { saldoFisico: 5 });

    await verificarReposicao(b.prisma as never, alvo());

    const [sc] = automaticas(b.estado);
    expect(sc.justificativa).toBe('Reposição automática: disponível 5 + a caminho 3 abaixo do mínimo 10.');
    expect(sc.itens.map((i) => i.quantidade)).toEqual([2]);
  });

  it('reposição a caminho que já cobre o mínimo: não cria', async () => {
    const b = montarBanco();
    b.plantarSolicitacao({ origem: 'manual', status: 'em_cotacao' }, [{ quantidade: 10 }]);

    expect(await verificarReposicao(b.prisma as never, alvo())).toBeNull();
    expect(automaticas(b.estado)).toEqual([]);
    expect(b.estado.auditoria).toEqual([]);
  });

  it('item de SC ligado a uma OS não conta na posição: a peça vai para a OS, não para a prateleira', async () => {
    const b = montarBanco();
    b.plantarSolicitacao({ origem: 'falta_os', prioridade: 'alta' }, [{ quantidade: 20, requisicaoItemId: 'ri-1', prioridade: 'alta' }]);

    await verificarReposicao(b.prisma as never, alvo());

    const [sc] = automaticas(b.estado);
    expect(sc.justificativa).toBe('Reposição automática: disponível 0 + a caminho 0 abaixo do mínimo 10.');
    expect(sc.itens.map((i) => i.quantidade)).toEqual([10]);
  });

  it.each(['rejeitada', 'cancelada'])('SC %s não conta na posição', async (status) => {
    const b = montarBanco();
    b.plantarSolicitacao({ origem: 'manual', status }, [{ quantidade: 20 }]);

    await verificarReposicao(b.prisma as never, alvo());

    expect(automaticas(b.estado).map((s) => s.justificativa)).toEqual([
      'Reposição automática: disponível 0 + a caminho 0 abaixo do mínimo 10.',
    ]);
  });

  it.each(['atendida', 'cancelada'])('item de reposição %s não conta na posição', async (status) => {
    const b = montarBanco();
    b.plantarSolicitacao({ origem: 'manual', status: 'aprovada' }, [{ quantidade: 20, status }]);

    await verificarReposicao(b.prisma as never, alvo());

    expect(automaticas(b.estado).map((s) => s.itens[0].quantidade)).toEqual([10]);
  });

  it.each([
    ['de outro depósito', { depositoId: 'dep-2' }],
    ['de outra empresa', { companyId: OUTRA }],
  ])('pedido %s não conta na posição', async (_nome, cabecalho) => {
    const b = montarBanco();
    b.plantarSolicitacao({ origem: 'manual', ...cabecalho }, [{ quantidade: 20 }]);

    await verificarReposicao(b.prisma as never, alvo());

    const criadas = automaticas(b.estado).filter((s) => s.companyId === COMPANY);
    expect(criadas.map((s) => [s.depositoId, s.justificativa])).toEqual([
      ['dep-1', 'Reposição automática: disponível 0 + a caminho 0 abaixo do mínimo 10.'],
    ]);
  });

  it('já existe reposição automática aberta do par: não cria outra, e a checagem barra antes do índice', async () => {
    const b = montarBanco();
    // O lote não basta para voltar ao mínimo: a posição continua abaixo.
    Object.assign(b.estado.pecas.get('p-1')!, { loteReposicao: 2 });
    b.plantarSolicitacao(
      { origem: 'estoque_minimo', prioridade: 'reposicao', numero: `SC-${ANO}-001` },
      [{ quantidade: 2, prioridade: 'reposicao', depositoReposicaoId: 'dep-1' }],
    );

    expect(await verificarReposicao(b.prisma as never, alvo())).toBeNull();

    expect(automaticas(b.estado).map((s) => s.numero)).toEqual([`SC-${ANO}-001`]);
    expect(b.estado.violacoesDoIndice).toEqual([]);
    expect(b.estado.auditoria).toEqual([]);
  });

  it('reposição automática aberta de OUTRO depósito não impede a deste', async () => {
    const b = montarBanco();
    b.estado.saldos.set('p-1|dep-2', saldo('p-1', 'dep-2'));
    b.plantarSolicitacao(
      { origem: 'estoque_minimo', prioridade: 'reposicao', depositoId: 'dep-2', numero: `SC-${ANO}-001` },
      [{ quantidade: 10, prioridade: 'reposicao', depositoReposicaoId: 'dep-2' }],
    );

    const r = await verificarReposicao(b.prisma as never, alvo());

    expect(r).toEqual({ solicitacaoId: expect.any(String), numero: `SC-${ANO}-002` });
    expect(automaticas(b.estado).map((s) => [s.depositoId, s.itens[0].depositoReposicaoId])).toEqual([
      ['dep-2', 'dep-2'],
      ['dep-1', 'dep-1'],
    ]);
  });

  it.each(['atendida', 'cancelada'])('reposição automática %s abre a vaga de novo', async (status) => {
    const b = montarBanco();
    b.plantarSolicitacao(
      { origem: 'estoque_minimo', prioridade: 'reposicao', numero: `SC-${ANO}-001` },
      [{ quantidade: 10, prioridade: 'reposicao', depositoReposicaoId: 'dep-1', status }],
    );

    const r = await verificarReposicao(b.prisma as never, alvo());

    expect(r?.numero).toBe(`SC-${ANO}-002`);
    expect(automaticas(b.estado).map((s) => s.itens[0].status)).toEqual([status, 'aberta']);
  });

  it.each<[string, (e: Estado) => void]>([
    ['peça inativa', (e) => (e.pecas.get('p-1')!.ativo = false)],
    ['mínimo zero', (e) => (e.pecas.get('p-1')!.estoqueMinimo = 0)],
    ['peça de outra empresa', (e) => (e.pecas.get('p-1')!.companyId = OUTRA)],
    ['depósito inativo', (e) => (e.depositos.get('dep-1')!.ativo = false)],
    ['depósito de outra empresa', (e) => (e.depositos.get('dep-1')!.companyId = OUTRA)],
    ['suprimentos desligado', (e) => (e.companyFeatures[0].enabled = false)],
    ['só outra feature ligada', (e) => (e.companyFeatures[0].featureId = 'f-mec')],
    ['sem linha de saldo', (e) => e.saldos.delete('p-1|dep-1')],
  ])('%s: não cria nada e não cria saldo', async (_nome, preparar) => {
    const b = montarBanco();
    preparar(b.estado);
    const saldosAntes = JSON.stringify([...b.estado.saldos.entries()]);

    expect(await verificarReposicao(b.prisma as never, alvo())).toBeNull();

    expect(b.estado.scs.size).toBe(0);
    expect(b.estado.scItens.size).toBe(0);
    expect(b.estado.auditoria).toEqual([]);
    expect(JSON.stringify([...b.estado.saldos.entries()])).toBe(saldosAntes);
  });

  describe('em nome de quem', () => {
    it.each<[string, (e: Estado) => void]>([
      ['gestor master inativo', (e) => (e.settings.get(COMPANY)!.gestorMasterCompanyUserId = 'cu-gestor-inativo')],
      ['gestor master de outra empresa', (e) => (e.settings.get(COMPANY)!.gestorMasterCompanyUserId = 'cu-owner-outra')],
      ['gestor master que não existe', (e) => (e.settings.get(COMPANY)!.gestorMasterCompanyUserId = 'cu-sumiu')],
      ['sem gestor master', (e) => (e.settings.get(COMPANY)!.gestorMasterCompanyUserId = null)],
      ['sem configuração da empresa', (e) => e.settings.delete(COMPANY)],
    ])('%s: cai no OWNER ativo mais antigo da empresa', async (_nome, preparar) => {
      const b = montarBanco();
      preparar(b.estado);

      await verificarReposicao(b.prisma as never, alvo());

      expect(automaticas(b.estado).map((s) => s.emNomeDeCompanyUserId)).toEqual(['cu-owner-antigo']);
      expect(b.estado.auditoria[0].depois.emNomeDeCompanyUserId).toBe('cu-owner-antigo');
    });

    it('sem gestor válido e sem OWNER ativo: a SC nasce sem dono', async () => {
      const b = montarBanco();
      b.estado.settings.get(COMPANY)!.gestorMasterCompanyUserId = 'cu-gestor-inativo';
      for (const id of ['cu-owner-novo', 'cu-owner-antigo']) b.estado.usuarios.get(id)!.status = 'INACTIVE';

      await verificarReposicao(b.prisma as never, alvo());

      expect(automaticas(b.estado).map((s) => [s.emNomeDeCompanyUserId, s.solicitanteCompanyUserId])).toEqual([[null, null]]);
    });
  });

  describe('concorrência', () => {
    it('decide pelo saldo relido DEPOIS da trava: entrada que commitou antes dela tira a peça do mínimo', async () => {
      const b = montarBanco();
      b.estado.ganchos.aoTravarSaldo = (e) => (e.saldos.get('p-1|dep-1')!.saldoFisico = 20);

      expect(await verificarReposicao(b.prisma as never, alvo())).toBeNull();

      expect(b.estado.log).toEqual(['trava:dep-1|p-1']);
      expect(b.estado.scs.size).toBe(0);
    });

    it('decide pelo saldo relido DEPOIS da trava: reserva que commitou antes dela põe a peça abaixo do mínimo', async () => {
      const b = montarBanco();
      Object.assign(b.estado.saldos.get('p-1|dep-1')!, { saldoFisico: 20 });
      b.estado.ganchos.aoTravarSaldo = (e) => (e.saldos.get('p-1|dep-1')!.saldoReservado = 18);

      await verificarReposicao(b.prisma as never, alvo());

      expect(automaticas(b.estado).map((s) => [s.justificativa, s.itens[0].quantidade])).toEqual([
        ['Reposição automática: disponível 2 + a caminho 0 abaixo do mínimo 10.', 8],
      ]);
    });

    it('a automática que outra verificação commitou antes da trava é vista pela checagem relida depois dela', async () => {
      const b = montarBanco();
      Object.assign(b.estado.pecas.get('p-1')!, { loteReposicao: 2 });
      b.estado.ganchos.aoTravarSaldo = (e) => {
        b.plantarSolicitacao(
          { origem: 'estoque_minimo', prioridade: 'reposicao', numero: `SC-${ANO}-001` },
          [{ quantidade: 2, prioridade: 'reposicao', depositoReposicaoId: 'dep-1' }],
        );
        e.ganchos.aoTravarSaldo = undefined;
      };

      expect(await verificarReposicao(b.prisma as never, alvo())).toBeNull();

      expect(automaticas(b.estado).map((s) => s.numero)).toEqual([`SC-${ANO}-001`]);
      expect(b.estado.violacoesDoIndice).toEqual([]);
    });

    it('P2002 no índice da reposição automática: outra criou antes — devolve nulo, sem tentar de novo e sem rastro', async () => {
      const b = montarBanco();
      // Commitou entre a nossa checagem e o nosso INSERT.
      b.estado.ganchos.antesDoInsert = () =>
        b.plantarSolicitacao(
          { origem: 'estoque_minimo', prioridade: 'reposicao', numero: `SC-${ANO}-050` },
          [{ quantidade: 10, prioridade: 'reposicao', depositoReposicaoId: 'dep-1' }],
        );

      expect(await verificarReposicao(b.prisma as never, alvo())).toBeNull();

      expect(b.prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(b.estado.violacoesDoIndice).toEqual(['p-1|dep-1']);
      expect(automaticas(b.estado).map((s) => s.numero)).toEqual([`SC-${ANO}-050`]);
      expect(b.estado.auditoria).toEqual([]);
    });

    it('P2002 de outro índice não é "outra criou antes": sobe, sem tentar de novo e sem nada gravado', async () => {
      const b = montarBanco();
      b.estado.ganchos.antesDoInsert = () => {
        throw erroDeUnique('solicitacao_compra_itens_uma_por_falta', ['requisicao_item_id']);
      };

      await expect(verificarReposicao(b.prisma as never, alvo())).rejects.toMatchObject({ code: 'P2002' });
      expect(b.prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(b.estado.scs.size).toBe(0);
      expect(b.estado.auditoria).toEqual([]);
    });

    it('P2002 no número: outra SC levou o número — refaz a transação e grava com o próximo, uma vez só', async () => {
      const b = montarBanco();
      b.estado.ganchos.antesDoInsert = () => b.plantarSolicitacao({ numero: `SC-${ANO}-001` }, []);

      const r = await verificarReposicao(b.prisma as never, alvo());

      expect(b.prisma.$transaction).toHaveBeenCalledTimes(2);
      expect(r?.numero).toBe(`SC-${ANO}-002`);
      expect(automaticas(b.estado).map((s) => [s.numero, s.itens.length])).toEqual([[`SC-${ANO}-002`, 1]]);
      expect(b.estado.auditoria.map((a) => a.alvoId)).toEqual([r!.solicitacaoId]);
    });

    it.each<[string, () => Prisma.PrismaClientKnownRequestError, 'trava' | 'insert']>([
      ['deadlock na trava (P2010 40P01)', () => erroDeContencao('P2010', '40P01'), 'trava'],
      ['serialização na trava (P2010 40001)', () => erroDeContencao('P2010', '40001'), 'trava'],
      ['deadlock no INSERT (P2039 40P01)', () => erroDeContencao('P2039', '40P01'), 'insert'],
    ])('%s: refaz a transação', async (_nome, erro, onde) => {
      const b = montarBanco();
      if (onde === 'trava') {
        b.estado.ganchos.aoTravarSaldo = (e) => {
          e.ganchos.aoTravarSaldo = undefined;
          throw erro();
        };
      } else {
        b.estado.ganchos.antesDoInsert = () => {
          throw erro();
        };
      }

      const r = await verificarReposicao(b.prisma as never, alvo());

      expect(b.prisma.$transaction).toHaveBeenCalledTimes(2);
      expect(automaticas(b.estado).map((s) => s.numero)).toEqual([r!.numero]);
    });

    it('erro que não é contenção sobe na primeira tentativa, sem nada gravado', async () => {
      const b = montarBanco();
      b.estado.ganchos.antesDoInsert = () => {
        throw new Error('conexão caiu');
      };

      await expect(verificarReposicao(b.prisma as never, alvo())).rejects.toThrow('conexão caiu');
      expect(b.prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(b.estado.scs.size).toBe(0);
    });
  });
});

describe('verificarReposicoesSemFalhar', () => {
  let erroLogado: jest.SpyInstance;
  beforeEach(() => {
    erroLogado = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => erroLogado.mockRestore());

  function bancoComVariosPares() {
    const b = montarBanco();
    b.estado.companyFeatures.push({ companyId: OUTRA, featureId: 'f-sup', enabled: true });
    b.estado.pecas.set('p-2', { id: 'p-2', companyId: COMPANY, codigoInterno: 'ALM-000002', ativo: true, estoqueMinimo: 5, loteReposicao: 0 });
    b.estado.pecas.set('p-9', { id: 'p-9', companyId: OUTRA, codigoInterno: 'ALM-000009', ativo: true, estoqueMinimo: 4, loteReposicao: 0 });
    // Depósito da outra empresa com id que ordena ANTES dos desta: a empresa vem primeiro.
    b.estado.depositos.set('dep-0', { id: 'dep-0', companyId: OUTRA, ativo: true });
    b.estado.saldos.set('p-2|dep-1', saldo('p-2', 'dep-1'));
    b.estado.saldos.set('p-1|dep-2', saldo('p-1', 'dep-2'));
    b.estado.saldos.set('p-9|dep-0', saldo('p-9', 'dep-0'));
    return b;
  }

  it('verifica cada par uma vez, na ordem empresa → depósito → peça, e segue depois de uma falha', async () => {
    const b = bancoComVariosPares();
    b.estado.ganchos.aoTravarSaldo = (_e, chave) => {
      if (chave === 'p-2|dep-1') throw new Error('conexão caiu');
    };

    const r = await verificarReposicoesSemFalhar(b.prisma as never, [
      alvo('p-9', 'dep-0', OUTRA),
      alvo('p-2', 'dep-1'),
      alvo('p-1', 'dep-2'),
      alvo('p-1', 'dep-1'),
      alvo('p-2', 'dep-1'),
      alvo('p-1', 'dep-1'),
    ]);

    expect(r).toEqual({ criadas: 3, falhas: 1 });
    expect(b.estado.log).toEqual(['trava:dep-1|p-1', 'trava:dep-1|p-2', 'trava:dep-2|p-1', 'trava:dep-0|p-9']);
    expect(automaticas(b.estado).map((s) => [s.companyId, s.numero, s.depositoId, s.itens[0].pecaId])).toEqual([
      [COMPANY, `SC-${ANO}-001`, 'dep-1', 'p-1'],
      [COMPANY, `SC-${ANO}-002`, 'dep-2', 'p-1'],
      [OUTRA, `SC-${ANO}-001`, 'dep-0', 'p-9'],
    ]);
    expect(erroLogado).toHaveBeenCalledTimes(1);
    expect(erroLogado.mock.calls[0][0]).toEqual(expect.stringContaining('peça p-2, depósito dep-1'));
    expect(erroLogado.mock.calls[0][0]).toEqual(expect.stringContaining('conexão caiu'));
  });

  it('nunca lança, mesmo quando toda verificação falha', async () => {
    const b = bancoComVariosPares();
    b.prisma.$transaction.mockRejectedValue(new Error('pool esgotado'));

    await expect(
      verificarReposicoesSemFalhar(b.prisma as never, [alvo('p-1', 'dep-1'), alvo('p-2', 'dep-1')]),
    ).resolves.toEqual({ criadas: 0, falhas: 2 });
    expect(erroLogado).toHaveBeenCalledTimes(2);
  });
});

describe('varrerEstoqueMinimo', () => {
  let erroLogado: jest.SpyInstance;
  beforeEach(() => {
    erroLogado = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => erroLogado.mockRestore());

  function bancoDaVarredura() {
    const b = montarBanco();
    const e = b.estado;
    e.companyFeatures.push(
      { companyId: OUTRA, featureId: 'f-sup', enabled: true },
      // Linha da feature desligada, e empresa só com outra feature.
      { companyId: TERCEIRA, featureId: 'f-sup', enabled: false },
      { companyId: '44444444-4444-4444-4444-444444444444', featureId: 'f-mec', enabled: true },
    );
    e.depositos.set('dep-3', { id: 'dep-3', companyId: COMPANY, ativo: false });
    e.depositos.set('dep-0', { id: 'dep-0', companyId: OUTRA, ativo: true });
    e.depositos.set('dep-t', { id: 'dep-t', companyId: TERCEIRA, ativo: true });
    const peca = (id: string, companyId: string, extra: Linha = {}) =>
      e.pecas.set(id, { id, companyId, codigoInterno: `ALM-${id}`, ativo: true, estoqueMinimo: 10, loteReposicao: 0, ...extra });
    peca('p-2', COMPANY);
    peca('p-3', COMPANY, { ativo: false });
    peca('p-4', COMPANY, { estoqueMinimo: 0 });
    peca('p-5', COMPANY);
    peca('p-6', COMPANY, { estoqueMinimo: 5 });
    peca('p-9', OUTRA);
    peca('p-t', TERCEIRA);
    e.saldos.set('p-2|dep-3', saldo('p-2', 'dep-3')); // depósito inativo
    e.saldos.set('p-3|dep-1', saldo('p-3', 'dep-1')); // peça inativa
    e.saldos.set('p-4|dep-1', saldo('p-4', 'dep-1')); // sem mínimo
    // p-5: controlada por mínimo, mas sem linha de saldo em depósito nenhum.
    e.saldos.set('p-6|dep-1', saldo('p-6', 'dep-1', 50)); // acima do mínimo: verificada, não pede
    e.saldos.set('p-9|dep-0', saldo('p-9', 'dep-0'));
    e.saldos.set('p-t|dep-t', saldo('p-t', 'dep-t')); // empresa com a feature desligada
    // Dado cruzado entre empresas: peça de uma num depósito da outra.
    e.saldos.set('p-1|dep-0', saldo('p-1', 'dep-0'));
    e.saldos.set('p-9|dep-1', saldo('p-9', 'dep-1'));
    return b;
  }

  it('só empresas com suprimentos ligada; só peça ativa com mínimo em depósito ativo, com linha de saldo, da própria empresa', async () => {
    const b = bancoDaVarredura();
    const saldosAntes = JSON.stringify([...b.estado.saldos.entries()]);

    const r = await varrerEstoqueMinimo(b.prisma as never);

    expect(r).toEqual({ empresas: 2, verificados: 3, criadas: 2, falhas: 0 });
    expect(automaticas(b.estado).map((s) => [s.companyId, s.numero, s.depositoId, s.itens[0].pecaId, s.itens[0].quantidade])).toEqual([
      [COMPANY, `SC-${ANO}-001`, 'dep-1', 'p-1', 10],
      [OUTRA, `SC-${ANO}-001`, 'dep-0', 'p-9', 10],
    ]);
    expect(b.estado.log.sort()).toEqual(['trava:dep-0|p-9', 'trava:dep-1|p-1', 'trava:dep-1|p-6']);
    expect(JSON.stringify([...b.estado.saldos.entries()])).toBe(saldosAntes);
    expect(erroLogado).not.toHaveBeenCalled();
  });

  it('a listagem de uma empresa que falha conta uma falha e não impede as outras', async () => {
    const b = bancoDaVarredura();
    b.estado.ganchos.aoListarPares = (where) => {
      if (where.peca.companyId === COMPANY) throw new Error('timeout');
    };

    const r = await varrerEstoqueMinimo(b.prisma as never);

    expect(r).toEqual({ empresas: 2, verificados: 1, criadas: 1, falhas: 1 });
    expect(automaticas(b.estado).map((s) => [s.companyId, s.itens[0].pecaId])).toEqual([[OUTRA, 'p-9']]);
    expect(erroLogado.mock.calls[0][0]).toEqual(expect.stringContaining(COMPANY));
  });
});
