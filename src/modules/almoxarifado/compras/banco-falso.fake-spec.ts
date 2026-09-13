/**
 * Banco falso de Compras que PERSISTE entre chamadas — molde de
 * `rodada-dois-persistido.spec.ts`, alargado para o ciclo inteiro da SC e da OC.
 *
 * Por que existe: teste que olha o valor RETORNADO em vez do GRAVADO já deixou
 * Critical passar nesta frente. Aqui toda asserção de estado (estado da OC,
 * `valorTotal`, estado da SC, `statusMateriais` da OS, `saldo_em_compra`) lê as
 * tabelas deste arquivo, que só mudam pelo que a produção de fato escreveu.
 *
 * O que o falso faz de verdade, para não aprovar por acaso:
 * - FILTRA pelo `where` (igualdade, `in`, `notIn`, `not`, `startsWith`, `OR`,
 *   filtro por relação) contra a linha hidratada com as relações — um `where`
 *   sem `companyId`, sem `type: 'FORNECEDOR'` ou sem o depósito deixa vazar as
 *   linhas plantadas que só esse pedaço do filtro exclui;
 * - `$transaction` DESFAZ tudo quando a função lança, como o rollback do banco;
 * - `$queryRaw` só reconhece as travas (`… FOR UPDATE`) das tabelas do ciclo e
 *   anota a ordem em `travas`; `$executeRaw` só reconhece a aritmética RELATIVA
 *   de `saldo_em_compra` — gravação absoluta lança — e aplica o CHECK
 *   `peca_saldos_em_compra_valido` (`>= 0`);
 * - índice único de `(companyId, numero)` devolve P2002 de número.
 *
 * O que ele NÃO faz: respeitar `select` (devolve a linha hidratada inteira). O
 * `select` é conferido pelo `npm run build` — o tipo do payload do Prisma não
 * deixa ler campo que não foi selecionado.
 *
 * O nome termina em `-spec.ts` e não em `.spec.ts` de propósito:
 * `tsconfig.build.json` exclui `**\/*spec.ts` do build (este arquivo usa
 * `jest`), e o `testRegex` do jest (`.*\.spec\.ts$`) não o toma por suíte.
 */
import { Prisma } from '../../../prisma/generated/client';
import { ComprasService } from './compras.service';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Linha = Record<string, any>;

export const EMPRESA = 'empresa-1';
export const OUTRA_EMPRESA = 'empresa-2';

export const DONO = 'user-dono';
export const ADMIN = 'user-admin';
export const COMPRADOR = 'user-comprador';
export const GESTOR = 'user-gestor';
export const ADMIN_INATIVO = 'user-admin-inativo';
export const DONO_DE_FORA = 'user-dono-de-fora';

export const FORNECEDOR = 'forn-ativo';
export const FORNECEDOR_INATIVO = 'forn-inativo';
export const FORNECEDOR_DE_FORA = 'forn-de-fora';
export const OFICINA = 'oficina-ativa';

export const DEPOSITO = 'dep-central';
export const DEPOSITO_FILIAL = 'dep-filial';
export const DEPOSITO_INATIVO = 'dep-inativo';
export const DEPOSITO_DE_FORA = 'dep-de-fora';

export const PECA_A = 'peca-a';
export const PECA_B = 'peca-b';
export const PECA_C = 'peca-c';
export const PECA_INATIVA = 'peca-inativa';
export const PECA_DE_FORA = 'peca-de-fora';

export const ANO = new Date().getUTCFullYear();

export interface Tabelas {
  companies: Linha[];
  companyUsers: Linha[];
  companySettings: Linha[];
  partners: Linha[];
  depositos: Linha[];
  pecas: Linha[];
  pecaSaldos: Linha[];
  serviceOrders: Linha[];
  requisicoes: Linha[];
  requisicaoItens: Linha[];
  solicitacoes: Linha[];
  solicitacaoItens: Linha[];
  ordens: Linha[];
  ordemItens: Linha[];
  origens: Linha[];
  auditoria: Linha[];
}

export interface Ganchos {
  /** Sobrescreve o `count` do PRÓXIMO `ordemCompra.updateMany` (uma vez). */
  contagemDaProximaTransicaoDaOrdem?: number;
  /** Lança este erro no PRÓXIMO `create` desta tabela (uma vez). */
  erroNoProximoCreate?: { tabela: keyof Tabelas; erro: unknown };
}

const OPERADORES = new Set(['in', 'notIn', 'not', 'startsWith', 'equals']);
const NAO_SUPORTADOS = new Set(['some', 'every', 'none', 'gt', 'gte', 'lt', 'lte', 'contains']);

function casa(obj: Linha | null | undefined, where: Linha | undefined): boolean {
  if (!where) return true;
  if (obj === null || obj === undefined) return false;
  for (const [campo, cond] of Object.entries(where)) {
    if (cond === undefined) continue;
    if (campo === 'OR') {
      if (!(cond as Linha[]).some((c) => casa(obj, c))) return false;
      continue;
    }
    if (campo === 'AND') {
      if (!(cond as Linha[]).every((c) => casa(obj, c))) return false;
      continue;
    }
    const valor = obj[campo];
    if (cond !== null && typeof cond === 'object' && !(cond instanceof Date) && !Array.isArray(cond)) {
      const chaves = Object.keys(cond);
      if (chaves.some((k) => NAO_SUPORTADOS.has(k))) {
        throw new Error(`banco falso: operador não suportado em "${campo}": ${chaves.join(',')} — atualize o falso`);
      }
      if (chaves.length > 0 && chaves.every((k) => OPERADORES.has(k))) {
        for (const op of chaves) {
          const alvo = (cond as Linha)[op];
          if (op === 'in' && !(alvo as unknown[]).includes(valor)) return false;
          if (op === 'notIn' && (alvo as unknown[]).includes(valor)) return false;
          if (op === 'not' && valor === alvo) return false;
          if (op === 'equals' && valor !== alvo) return false;
          if (op === 'startsWith' && !(typeof valor === 'string' && valor.startsWith(alvo as string))) return false;
        }
        continue;
      }
      // Filtro por relação (ex.: `solicitacao: { companyId }`).
      if (!casa(valor, cond as Linha)) return false;
      continue;
    }
    if (valor !== cond) return false;
  }
  return true;
}

/** `{ pecaId_depositoId: { pecaId, depositoId } }` → `{ pecaId, depositoId }`. */
function achatar(where: Linha): Linha {
  const plano: Linha = {};
  for (const [k, v] of Object.entries(where ?? {})) {
    if (k.includes('_') && v && typeof v === 'object') Object.assign(plano, v);
    else plano[k] = v;
  }
  return plano;
}

function ordenar(linhas: Linha[], orderBy: Linha | Linha[]): Linha[] {
  const criterios = (Array.isArray(orderBy) ? orderBy : [orderBy]).flatMap((o) => Object.entries(o));
  return [...linhas].sort((a, b) => {
    for (const [campo, dir] of criterios) {
      const va = a[campo] instanceof Date ? a[campo].getTime() : a[campo];
      const vb = b[campo] instanceof Date ? b[campo].getTime() : b[campo];
      if (va === vb) continue;
      const r = va < vb ? -1 : 1;
      return dir === 'desc' ? -r : r;
    }
    return 0;
  });
}

/**
 * Cópia profunda que preserva `Date` do MESMO realm do teste. `structuredClone`
 * devolve `Date` do realm do Node, e o `instanceof Date` do sandbox do jest
 * (`expect.any(Date)`, `toBeInstanceOf(Date)`) reprova esse objeto.
 */
function clonar<T>(valor: T): T {
  if (valor instanceof Date) return new Date(valor.getTime()) as T;
  if (Array.isArray(valor)) return valor.map((v) => clonar(v)) as T;
  if (valor !== null && typeof valor === 'object') {
    return Object.fromEntries(Object.entries(valor).map(([k, v]) => [k, clonar(v)])) as T;
  }
  return valor;
}

function erroDeNumero(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed on the fields: (`company_id`,`numero`)', {
    code: 'P2002',
    clientVersion: 'banco-falso',
    meta: { target: ['companyId', 'numero'] },
  });
}

export function montarBancoFalso() {
  const t: Tabelas = {
    companies: [
      { id: EMPRESA, legacyId: 'leg-empresa-1' },
      { id: OUTRA_EMPRESA, legacyId: 'leg-empresa-2' },
    ],
    companyUsers: [
      { id: DONO, companyId: EMPRESA, role: 'OWNER', status: 'ACTIVE', name: 'Dona', email: 'dona@x' },
      { id: ADMIN, companyId: EMPRESA, role: 'ADMIN', status: 'ACTIVE', name: 'Admin', email: 'admin@x' },
      { id: COMPRADOR, companyId: EMPRESA, role: 'MEMBER', status: 'ACTIVE', name: 'Comprador', email: 'compras@x' },
      { id: GESTOR, companyId: EMPRESA, role: 'MEMBER', status: 'ACTIVE', name: 'Gestor', email: 'gestor@x' },
      { id: ADMIN_INATIVO, companyId: EMPRESA, role: 'ADMIN', status: 'INACTIVE', name: 'Ex-admin', email: 'ex@x' },
      { id: DONO_DE_FORA, companyId: OUTRA_EMPRESA, role: 'OWNER', status: 'ACTIVE', name: 'Outro', email: 'outro@x' },
    ],
    companySettings: [],
    partners: [
      { id: FORNECEDOR, companyId: EMPRESA, type: 'FORNECEDOR', ativo: true, razaoSocial: 'Peças Rio Claro Ltda', nomeFantasia: 'Peças RC', cnpj: '11.111.111/0001-11' },
      { id: FORNECEDOR_INATIVO, companyId: EMPRESA, type: 'FORNECEDOR', ativo: false, razaoSocial: 'Fornecedor Antigo', nomeFantasia: null, cnpj: null },
      { id: FORNECEDOR_DE_FORA, companyId: OUTRA_EMPRESA, type: 'FORNECEDOR', ativo: true, razaoSocial: 'Fornecedor de Fora', nomeFantasia: null, cnpj: null },
      { id: OFICINA, companyId: EMPRESA, type: 'OFICINA', ativo: true, razaoSocial: 'Oficina Credenciada', nomeFantasia: null, cnpj: null },
    ],
    depositos: [
      { id: DEPOSITO, companyId: EMPRESA, nome: 'Almoxarifado Central', ativo: true },
      { id: DEPOSITO_FILIAL, companyId: EMPRESA, nome: 'Filial', ativo: true },
      { id: DEPOSITO_INATIVO, companyId: EMPRESA, nome: 'Desativado', ativo: false },
      { id: DEPOSITO_DE_FORA, companyId: OUTRA_EMPRESA, nome: 'Depósito de Fora', ativo: true },
    ],
    pecas: [
      { id: PECA_A, companyId: EMPRESA, codigoInterno: 'ALM-000001', descricao: 'Filtro de óleo', unidade: 'un', ativo: true },
      { id: PECA_B, companyId: EMPRESA, codigoInterno: 'ALM-000002', descricao: 'Óleo 15W40', unidade: 'L', ativo: true },
      { id: PECA_C, companyId: EMPRESA, codigoInterno: 'ALM-000003', descricao: 'Correia', unidade: 'un', ativo: true },
      { id: PECA_INATIVA, companyId: EMPRESA, codigoInterno: 'ALM-000009', descricao: 'Fora de linha', unidade: 'un', ativo: false },
      { id: PECA_DE_FORA, companyId: OUTRA_EMPRESA, codigoInterno: 'ALM-000001', descricao: 'Peça de outra empresa', unidade: 'un', ativo: true },
    ],
    pecaSaldos: [],
    serviceOrders: [],
    requisicoes: [],
    requisicaoItens: [],
    solicitacoes: [],
    solicitacaoItens: [],
    ordens: [],
    ordemItens: [],
    origens: [],
    auditoria: [],
  };

  const travas: string[] = [];
  const ganchos: Ganchos = {};
  let sequencia = 0;

  const por = (lista: Linha[], id: string | null | undefined) => (id ? lista.find((r) => r.id === id) ?? null : null);

  // --- Hidratação (as relações que o serviço e `cobertura.ts` leem) ---------
  const vOrigem = (o: Linha): Linha => {
    const ocItem = por(t.ordemItens, o.ordemCompraItemId);
    const scItem = por(t.solicitacaoItens, o.solicitacaoCompraItemId);
    const sc = scItem ? por(t.solicitacoes, scItem.solicitacaoId) : null;
    return {
      ...o,
      ordemCompraItem: ocItem ? { ...ocItem, ordemCompra: { ...por(t.ordens, ocItem.ordemCompraId) } } : null,
      solicitacaoCompraItem: scItem
        ? {
            ...scItem,
            solicitacao: sc ? { ...sc, serviceOrder: sc.serviceOrderId ? { ...por(t.serviceOrders, sc.serviceOrderId) } : null } : null,
            requisicaoItem: scItem.requisicaoItemId ? { ...por(t.requisicaoItens, scItem.requisicaoItemId) } : null,
          }
        : null,
    };
  };
  const vScItem = (i: Linha): Linha => ({
    ...i,
    peca: { ...por(t.pecas, i.pecaId) },
    solicitacao: { ...por(t.solicitacoes, i.solicitacaoId) },
    requisicaoItem: i.requisicaoItemId ? { ...por(t.requisicaoItens, i.requisicaoItemId) } : null,
    origensOc: t.origens.filter((o) => o.solicitacaoCompraItemId === i.id).map(vOrigem),
  });
  const vSolicitacao = (sc: Linha): Linha => ({
    ...sc,
    deposito: { ...por(t.depositos, sc.depositoId) },
    serviceOrder: sc.serviceOrderId ? { ...por(t.serviceOrders, sc.serviceOrderId) } : null,
    itens: t.solicitacaoItens.filter((i) => i.solicitacaoId === sc.id).map(vScItem),
  });
  const vOrdemItem = (i: Linha): Linha => ({
    ...i,
    peca: { ...por(t.pecas, i.pecaId) },
    ordemCompra: { ...por(t.ordens, i.ordemCompraId) },
    origens: t.origens.filter((o) => o.ordemCompraItemId === i.id).map(vOrigem),
  });
  const vOrdem = (oc: Linha): Linha => ({
    ...oc,
    fornecedor: { ...por(t.partners, oc.partnerId) },
    deposito: { ...por(t.depositos, oc.depositoId) },
    itens: t.ordemItens.filter((i) => i.ordemCompraId === oc.id).map(vOrdemItem),
  });
  const vRequisicao = (r: Linha): Linha => ({
    ...r,
    serviceOrder: { ...por(t.serviceOrders, r.serviceOrderId) },
    itens: t.requisicaoItens.filter((i) => i.requisicaoId === r.id).map((i) => ({ ...i })),
  });
  const plana = (r: Linha): Linha => ({ ...r });

  const PADROES: Partial<Record<keyof Tabelas, () => Linha>> = {
    solicitacoes: () => ({
      status: 'pendente', justificativa: null, serviceOrderId: null, requisicaoId: null,
      solicitanteCompanyUserId: null, emNomeDeCompanyUserId: null,
      rejeitadaEm: null, rejeitadaPorCompanyUserId: null, motivoRejeicao: null,
      canceladaEm: null, canceladaPorCompanyUserId: null, motivoCancelamento: null,
    }),
    solicitacaoItens: () => ({ status: 'aberta', requisicaoItemId: null, dataNecessidade: null }),
    ordens: () => ({
      status: 'rascunho', condicaoPagamento: null, previsaoEntrega: null, observacao: null, valorTotal: 0,
      emitidaEm: null, emitidaPorCompanyUserId: null, aprovadaEm: null, aprovadaPorCompanyUserId: null,
      devolvidaEm: null, devolvidaPorCompanyUserId: null, motivoDevolucao: null,
      enviadaEm: null, enviadaPorCompanyUserId: null, canceladaEm: null, canceladaPorCompanyUserId: null,
      motivoCancelamento: null, encerradaEm: null, encerradaPorCompanyUserId: null, motivoEncerramento: null,
    }),
    ordemItens: () => ({ quantidadeRecebida: 0, valorUnit: 0 }),
    origens: () => ({ quantidadeRecebida: 0 }),
  };

  function criar(tabela: keyof Tabelas, data: Linha): Linha {
    if (ganchos.erroNoProximoCreate?.tabela === tabela) {
      const { erro } = ganchos.erroNoProximoCreate;
      ganchos.erroNoProximoCreate = undefined;
      throw erro;
    }
    const { itens, origens, ...escalares } = data;
    const agora = new Date();
    const linha: Linha = {
      id: `${tabela}-novo-${++sequencia}`,
      ...(PADROES[tabela]?.() ?? {}),
      ...escalares,
      createdAt: agora,
      updatedAt: agora,
    };
    if ((tabela === 'solicitacoes' || tabela === 'ordens') &&
        t[tabela].some((r) => r.companyId === linha.companyId && r.numero === linha.numero)) {
      throw erroDeNumero();
    }
    if (tabela === 'ordemItens' &&
        t.ordemItens.some((r) => r.ordemCompraId === linha.ordemCompraId && r.pecaId === linha.pecaId)) {
      throw new Error('banco falso: ordem_compra_itens_uma_linha_por_peca violado');
    }
    t[tabela].push(linha);
    if (tabela === 'solicitacoes' && itens?.create) {
      for (const i of itens.create as Linha[]) criar('solicitacaoItens', { ...i, solicitacaoId: linha.id });
    }
    if (tabela === 'ordemItens' && origens?.create) {
      for (const o of origens.create as Linha[]) criar('origens', { ...o, ordemCompraItemId: linha.id });
    }
    return linha;
  }

  function delegate(tabela: keyof Tabelas, vista: (r: Linha) => Linha) {
    const ler = (args?: Linha): Linha[] => {
      let linhas = t[tabela].map(vista).filter((r) => casa(r, args?.where));
      if (args?.orderBy) linhas = ordenar(linhas, args.orderBy);
      if (args?.take !== undefined) linhas = linhas.slice(0, args.take);
      return clonar(linhas);
    };
    return {
      findMany: jest.fn(async (args?: Linha) => ler(args)),
      findFirst: jest.fn(async (args?: Linha) => ler(args)[0] ?? null),
      findUnique: jest.fn(async (args: Linha) => ler({ where: achatar(args.where) })[0] ?? null),
      findUniqueOrThrow: jest.fn(async (args: Linha) => {
        const achada = ler({ where: achatar(args.where) })[0];
        if (!achada) throw new Error(`banco falso: ${tabela} não encontrado para ${JSON.stringify(args.where)}`);
        return achada;
      }),
      create: jest.fn(async (args: Linha) => clonar(vista(criar(tabela, args.data)))),
      updateMany: jest.fn(async (args: Linha) => {
        const alvo = t[tabela].filter((r) => casa(vista(r), args.where));
        if (tabela === 'ordens' && ganchos.contagemDaProximaTransicaoDaOrdem !== undefined) {
          const count = ganchos.contagemDaProximaTransicaoDaOrdem;
          ganchos.contagemDaProximaTransicaoDaOrdem = undefined;
          if (count === 0) return { count: 0 };
        }
        for (const r of alvo) Object.assign(r, args.data, { updatedAt: new Date() });
        return { count: alvo.length };
      }),
      deleteMany: jest.fn(async (args: Linha) => {
        const alvo = t[tabela].filter((r) => casa(vista(r), args.where));
        t[tabela] = t[tabela].filter((r) => !alvo.includes(r));
        if (tabela === 'ordemItens') {
          const ids = new Set(alvo.map((r) => r.id));
          t.origens = t.origens.filter((o) => !ids.has(o.ordemCompraItemId));
        }
        return { count: alvo.length };
      }),
    };
  }

  const saldoDe = (pecaId: string, depositoId: string) =>
    t.pecaSaldos.find((s) => s.pecaId === pecaId && s.depositoId === depositoId) ?? null;

  const tx = {
    $queryRaw: jest.fn(async (sql: { text: string; values: unknown[] }) => {
      const texto = sql.text;
      if (!/FOR UPDATE/.test(texto)) throw new Error(`banco falso: $queryRaw sem FOR UPDATE: ${texto}`);
      const [a, b] = sql.values as string[];
      if (/FROM\s+ordens_compra\b/.test(texto)) {
        travas.push(`ordens_compra:${a}`);
        return t.ordens.some((r) => r.id === a && r.companyId === b) ? [{ id: a }] : [];
      }
      if (/FROM\s+requisicoes_material\b/.test(texto)) {
        travas.push(`requisicoes_material:${a}`);
        return t.requisicoes.some((r) => r.id === a && r.companyId === b) ? [{ id: a }] : [];
      }
      if (/FROM\s+solicitacao_compra_itens\b/.test(texto)) {
        travas.push(`solicitacao_compra_itens:${a}`);
        return t.solicitacaoItens.some((r) => r.id === a) ? [{ id: a }] : [];
      }
      if (/FROM\s+solicitacoes_compra\b/.test(texto)) {
        travas.push(`solicitacoes_compra:${a}`);
        return t.solicitacoes.some((r) => r.id === a && r.companyId === b) ? [{ id: a }] : [];
      }
      if (/FROM\s+peca_saldos\b/.test(texto)) {
        travas.push(`peca_saldos:${a}`);
        const s = saldoDe(a, b);
        return s ? [{ saldo_em_compra: String(s.saldoEmCompra) }] : [];
      }
      throw new Error(`banco falso: $queryRaw não reconhecido: ${texto}`);
    }),
    $executeRaw: jest.fn(async (sql: { text: string; values: unknown[] }) => {
      const m = /UPDATE\s+peca_saldos\s+SET\s+saldo_em_compra\s*=\s*saldo_em_compra\s*([+-])\s*\$1\b/.exec(sql.text);
      if (!m) throw new Error(`banco falso: $executeRaw não reconhecido (só aritmética relativa de saldo_em_compra): ${sql.text}`);
      const [quantidade, pecaId, depositoId] = sql.values as [number, string, string];
      const s = saldoDe(pecaId, depositoId);
      if (!s) return 0;
      const novo = Math.round((s.saldoEmCompra * 1000 + (m[1] === '+' ? 1 : -1) * Math.round(quantidade * 1000))) / 1000;
      if (novo < 0) throw new Error('new row for relation "peca_saldos" violates check constraint "peca_saldos_em_compra_valido"');
      s.saldoEmCompra = novo;
      return 1;
    }),
    company: delegate('companies', plana),
    companyUser: delegate('companyUsers', plana),
    companySettings: delegate('companySettings', plana),
    partner: delegate('partners', plana),
    deposito: delegate('depositos', plana),
    peca: delegate('pecas', plana),
    serviceOrder: delegate('serviceOrders', plana),
    requisicaoMaterial: delegate('requisicoes', vRequisicao),
    solicitacaoCompra: delegate('solicitacoes', vSolicitacao),
    solicitacaoCompraItem: delegate('solicitacaoItens', vScItem),
    ordemCompra: delegate('ordens', vOrdem),
    ordemCompraItem: delegate('ordemItens', vOrdemItem),
    pontoAuditoria: delegate('auditoria', plana),
    pecaSaldo: {
      upsert: jest.fn(async (args: Linha) => {
        const chave = achatar(args.where);
        const existente = saldoDe(chave.pecaId, chave.depositoId);
        if (existente) {
          Object.assign(existente, args.update);
          return { ...existente };
        }
        const nova: Linha = { saldoFisico: 0, saldoReservado: 0, saldoSeparado: 0, saldoEmCompra: 0, ...args.create };
        t.pecaSaldos.push(nova);
        return { ...nova };
      }),
    },
    // NUNCA deve ser chamado: quem grava aviso é `enviarNotificacoes(this.prisma, …)`,
    // depois do commit. Um jest.fn próprio, diferente do de `prisma`, para a
    // asserção distinguir qual client gravou.
    notificacao: { createMany: jest.fn(async (args: Linha) => ({ count: (args.data as unknown[]).length })) },
  };

  const notificacoesGravadas: Linha[] = [];
  const prisma = {
    ...tx,
    $transaction: jest.fn(async (fn: (cliente: typeof tx) => Promise<unknown>) => {
      const copia = clonar(t);
      try {
        return await fn(tx);
      } catch (erro) {
        for (const chave of Object.keys(t) as Array<keyof Tabelas>) t[chave] = copia[chave];
        throw erro;
      }
    }),
    notificacao: {
      createMany: jest.fn(async (args: Linha) => {
        notificacoesGravadas.push(...(args.data as Linha[]));
        return { count: (args.data as unknown[]).length };
      }),
    },
  };

  // --- Plantio ---------------------------------------------------------------

  function plantarSolicitacao(sc: {
    id: string;
    numero: string;
    origem?: string;
    status?: string;
    prioridade?: string;
    depositoId?: string;
    companyId?: string;
    serviceOrderId?: string | null;
    requisicaoId?: string | null;
    createdAt?: Date;
    itens: Array<{
      id: string;
      pecaId: string;
      quantidade: number;
      requisicaoItemId?: string | null;
      status?: string;
      prioridade?: string;
      dataNecessidade?: Date | null;
      createdAt?: Date;
    }>;
  }) {
    const criadaEm = sc.createdAt ?? new Date('2026-09-10T10:00:00Z');
    t.solicitacoes.push({
      ...PADROES.solicitacoes!(),
      id: sc.id,
      companyId: sc.companyId ?? EMPRESA,
      numero: sc.numero,
      origem: sc.origem ?? 'manual',
      status: sc.status ?? 'pendente',
      prioridade: sc.prioridade ?? 'normal',
      depositoId: sc.depositoId ?? DEPOSITO,
      serviceOrderId: sc.serviceOrderId ?? null,
      requisicaoId: sc.requisicaoId ?? null,
      createdAt: criadaEm,
      updatedAt: criadaEm,
    });
    for (const i of sc.itens) {
      t.solicitacaoItens.push({
        ...PADROES.solicitacaoItens!(),
        id: i.id,
        solicitacaoId: sc.id,
        pecaId: i.pecaId,
        quantidade: i.quantidade,
        requisicaoItemId: i.requisicaoItemId ?? null,
        status: i.status ?? 'aberta',
        prioridade: i.prioridade ?? sc.prioridade ?? 'normal',
        dataNecessidade: i.dataNecessidade ?? null,
        createdAt: i.createdAt ?? criadaEm,
        updatedAt: criadaEm,
      });
    }
  }

  function plantarOrdem(oc: {
    id: string;
    numero: string;
    status?: string;
    partnerId?: string;
    depositoId?: string;
    companyId?: string;
    criadaPorCompanyUserId?: string;
    valorTotal?: number;
    createdAt?: Date;
    itens?: Array<{
      id: string;
      pecaId: string;
      quantidade: number;
      quantidadeRecebida?: number;
      valorUnit: number;
      origens: Array<{ id: string; solicitacaoCompraItemId: string; quantidade: number; quantidadeRecebida?: number }>;
    }>;
  }) {
    const criadaEm = oc.createdAt ?? new Date('2026-09-11T10:00:00Z');
    t.ordens.push({
      ...PADROES.ordens!(),
      id: oc.id,
      companyId: oc.companyId ?? EMPRESA,
      numero: oc.numero,
      status: oc.status ?? 'rascunho',
      partnerId: oc.partnerId ?? FORNECEDOR,
      depositoId: oc.depositoId ?? DEPOSITO,
      criadaPorCompanyUserId: oc.criadaPorCompanyUserId ?? COMPRADOR,
      valorTotal: oc.valorTotal ?? 0,
      createdAt: criadaEm,
      updatedAt: criadaEm,
    });
    for (const i of oc.itens ?? []) {
      t.ordemItens.push({
        id: i.id, ordemCompraId: oc.id, pecaId: i.pecaId, quantidade: i.quantidade,
        quantidadeRecebida: i.quantidadeRecebida ?? 0, valorUnit: i.valorUnit, createdAt: criadaEm, updatedAt: criadaEm,
      });
      for (const o of i.origens) {
        t.origens.push({
          id: o.id, ordemCompraItemId: i.id, solicitacaoCompraItemId: o.solicitacaoCompraItemId,
          quantidade: o.quantidade, quantidadeRecebida: o.quantidadeRecebida ?? 0, createdAt: criadaEm, updatedAt: criadaEm,
        });
      }
    }
  }

  /**
   * Uma OS parada por falta: requisição com um item `faltante` (pediu
   * `solicitada`, reservou `reservada`) e a SC `falta_os` que cobre a diferença.
   */
  function plantarFaltaDeOs(f: {
    serviceOrderId: string;
    protocolo: string;
    statusMateriais: string;
    requisicaoId: string;
    requisicaoItemId: string;
    pecaId: string;
    solicitada: number;
    reservada: number;
    solicitacaoId: string;
    solicitacaoNumero: string;
    solicitacaoItemId: string;
    quantidadeSolicitacao: number;
    statusSolicitacao?: string;
  }) {
    t.serviceOrders.push({ id: f.serviceOrderId, companyId: EMPRESA, protocolo: f.protocolo, statusMateriais: f.statusMateriais, equipmentNome: 'Retroescavadeira 3' });
    t.requisicoes.push({ id: f.requisicaoId, companyId: EMPRESA, serviceOrderId: f.serviceOrderId, depositoId: DEPOSITO, status: 'pendente', numero: `REQ-${f.requisicaoId}` });
    t.requisicaoItens.push({
      id: f.requisicaoItemId, requisicaoId: f.requisicaoId, pecaId: f.pecaId, status: 'faltante',
      quantidadeSolicitada: f.solicitada, quantidadeReservada: f.reservada, impeditivo: true,
      // O default da coluna. `cobertura.ts` lê a origem para separar falta do
      // plano de peça adicional — linha real nunca vem sem ela, e deixá-la
      // `undefined` aqui só acertaria por acaso.
      origem: 'plano',
    });
    plantarSolicitacao({
      id: f.solicitacaoId,
      numero: f.solicitacaoNumero,
      origem: 'falta_os',
      status: f.statusSolicitacao ?? 'pendente',
      prioridade: 'critica',
      serviceOrderId: f.serviceOrderId,
      requisicaoId: f.requisicaoId,
      itens: [{ id: f.solicitacaoItemId, pecaId: f.pecaId, quantidade: f.quantidadeSolicitacao, requisicaoItemId: f.requisicaoItemId }],
    });
  }

  function configurar(config: { limite: number | null; gestorMaster?: string | null } | null) {
    t.companySettings = config
      ? [{ companyId: EMPRESA, comprasLimiteAprovacao: config.limite, gestorMasterCompanyUserId: config.gestorMaster ?? null }]
      : [];
  }

  function plantarSaldo(pecaId: string, depositoId: string, saldoEmCompra: number) {
    t.pecaSaldos.push({ pecaId, depositoId, saldoFisico: 0, saldoReservado: 0, saldoSeparado: 0, saldoEmCompra });
  }

  // Leitura das tabelas SEMPRE pelo objeto atual: o rollback troca os arrays.
  const banco = {
    ordem: (id: string) => t.ordens.find((r) => r.id === id),
    itensDaOrdem: (id: string) => t.ordemItens.filter((r) => r.ordemCompraId === id),
    origensDoItem: (id: string) => t.origens.filter((r) => r.ordemCompraItemId === id),
    solicitacao: (id: string) => t.solicitacoes.find((r) => r.id === id),
    itemDeSolicitacao: (id: string) => t.solicitacaoItens.find((r) => r.id === id),
    os: (id: string) => t.serviceOrders.find((r) => r.id === id),
    saldo: saldoDe,
    auditoria: () => t.auditoria,
    tabelas: () => t,
  };

  return {
    servico: new ComprasService(prisma as never),
    prisma,
    tx,
    banco,
    travas,
    ganchos,
    notificacoesGravadas,
    plantarSolicitacao,
    plantarOrdem,
    plantarFaltaDeOs,
    plantarSaldo,
    configurar,
  };
}

/** As chamadas de `$executeRaw` como `{ texto, valores }` — para afirmar o SQL. */
export function sqlsDeSaldo(tx: { $executeRaw: jest.Mock }): Array<{ texto: string; valores: unknown[] }> {
  return tx.$executeRaw.mock.calls.map(([sql]: [{ text: string; values: unknown[] }]) => ({
    texto: sql.text,
    valores: sql.values,
  }));
}
