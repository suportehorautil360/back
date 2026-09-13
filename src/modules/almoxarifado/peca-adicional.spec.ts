import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { AlmoxarifadoService } from './almoxarifado.service';
import { Prisma } from '../../prisma/generated/client';

// §5 da F4: a verificação de estoque mínimo roda DEPOIS do commit e nunca
// lança. Mockada aqui para afirmar QUANDO e COM QUE alvos é chamada — o motor
// dela tem suíte própria (`compras/estoque-minimo.spec.ts`).
jest.mock('./compras/estoque-minimo', () => ({
  verificarReposicoesSemFalhar: jest.fn(async () => ({ criadas: 0, falhas: 0 })),
}));
import { verificarReposicoesSemFalhar } from './compras/estoque-minimo';
const verificouReposicao = verificarReposicoesSemFalhar as jest.Mock;

const COMPANY = '11111111-1111-1111-1111-111111111111';
const OUTRA = '99999999-9999-9999-9999-999999999999';
const AUTOR = '44444444-4444-4444-4444-444444444444';

type Linha = Record<string, any>;

interface Opcoes {
  /** Estado da requisição `req-1` da OS (no depósito `dep-2`); nulo = OS sem requisição. */
  statusRequisicao?: string | null;
  saldo?: { fisico: number; reservado: number } | null;
  /** Item do plano faltante e sem compra na `req-1`. */
  faltaDoPlanoDescoberta?: boolean;
  os?: Partial<{ execucao: string; situacao: string; statusMateriais: string; companyId: string }>;
  pecaAtiva?: boolean;
  semDeposito?: boolean;
  /** O UPDATE condicionado do saldo não grava (a guarda do banco barrou). */
  guardaDoSaldoFalha?: boolean;
  aoTravarRequisicao?: (estado: Estado) => void;
  /** A primeira transação perde a corrida no índice de requisição aberta por OS. */
  colisaoNaPrimeira?: boolean;
}

type Estado = ReturnType<typeof montar>['estado'];

/**
 * Banco fake que PERSISTE e FILTRA pelos `where` que a produção usa — `where`
 * não reconhecido lança. O UPDATE de saldo reproduz a guarda
 * `saldo_fisico - saldo_reservado >= x`; a trava da requisição filtra por
 * empresa só quando o SQL filtra.
 */
function montar(opts: Opcoes = {}) {
  const log: string[] = [];
  const quando = (d: string) => new Date(d);
  const statusReq = opts.statusRequisicao === undefined ? 'separada' : opts.statusRequisicao;

  const os = {
    id: 'os-1', companyId: COMPANY, execucao: 'interna', situacao: 'EmAndamento', statusMateriais: 'liberada_para_execucao',
    protocolo: 'OS-2026-047', equipmentId: 'eq-1', equipmentNome: 'Retro 01', ...opts.os,
  };
  const depositos = opts.semDeposito
    ? []
    : [
        { id: 'dep-1', companyId: COMPANY, ativo: true, createdAt: quando('2026-01-01') },
        { id: 'dep-2', companyId: COMPANY, ativo: true, createdAt: quando('2026-05-01') },
      ];
  const pecas = new Map<string, Linha>([
    ['p-1', { id: 'p-1', companyId: COMPANY, ativo: opts.pecaAtiva ?? true, descricao: 'Correia', codigoInterno: 'ALM-000007' }],
  ]);
  const reqs = new Map<string, Linha>();
  const itens = new Map<string, Linha>();
  if (statusReq) {
    reqs.set('req-1', {
      id: 'req-1', companyId: COMPANY, serviceOrderId: 'os-1', depositoId: 'dep-2', numero: 'REQ-2026-001',
      status: statusReq, createdAt: quando('2026-09-10'),
    });
    itens.set('it-1', {
      id: 'it-1', requisicaoId: 'req-1', pecaId: 'p-9', status: statusReq === 'entregue' ? 'entregue' : 'separada',
      impeditivo: true, origem: 'plano', quantidadeSolicitada: 1, quantidadeReservada: 1,
    });
    if (opts.faltaDoPlanoDescoberta) {
      itens.set('it-9', {
        id: 'it-9', requisicaoId: 'req-1', pecaId: 'p-8', status: 'faltante', impeditivo: false, origem: 'plano',
        quantidadeSolicitada: 2, quantidadeReservada: 0,
      });
    }
  }
  const saldos = new Map<string, Linha>();
  if (opts.saldo !== null) {
    const s = opts.saldo ?? { fisico: 5, reservado: 1 };
    saldos.set('p-1|dep-2', { saldoFisico: s.fisico, saldoReservado: s.reservado });
  }
  const scs: Linha[] = [];
  const auditoria: Linha[] = [];
  const estado = { log, os, reqs, itens, saldos, scs, auditoria };
  let seqReq = 0;
  let seqItem = 0;

  const naoReconhecido = (onde: string, arg: unknown): never => {
    throw new Error(`${onde}: where não reconhecido neste fake — ${JSON.stringify(arg)}`);
  };

  const db = {
    $queryRaw: jest.fn(async (q: { text: string; values: unknown[] }) => {
      const v = q.values;
      if (q.text.includes('FROM requisicoes_material')) {
        log.push(`trava:req:${v[0]}`);
        const r = reqs.get(v[0] as string);
        if (r && opts.aoTravarRequisicao) opts.aoTravarRequisicao(estado);
        const filtra = q.text.includes('company_id');
        return r && (!filtra || r.companyId === v[1]) ? [{ id: r.id }] : [];
      }
      if (q.text.includes('FROM peca_saldos')) {
        log.push(`trava:saldo:${v[0]}|${v[1]}`);
        return saldos.has(`${v[0]}|${v[1]}`) ? [{ peca_id: v[0] }] : [];
      }
      throw new Error(`SQL não reconhecido: ${q.text}`);
    }),
    $executeRaw: jest.fn(async (q: { text: string; values: unknown[] }) => {
      if (!q.text.includes('UPDATE peca_saldos')) throw new Error(`SQL não reconhecido: ${q.text}`);
      if (!/saldo_reservado\s*=\s*saldo_reservado\s*\+/.test(q.text)) throw new Error('UPDATE de saldo fora do formato');
      const [x, pecaId, depositoId, guarda] = q.values as [number, string, string, number | undefined];
      const s = saldos.get(`${pecaId}|${depositoId}`);
      if (!s) return 0;
      // Sem a guarda no SQL, o fake não guarda: é o que prova a guarda.
      const temGuarda = q.text.includes('saldo_fisico - saldo_reservado >=');
      if (temGuarda && (opts.guardaDoSaldoFalha || s.saldoFisico - s.saldoReservado < (guarda as number))) return 0;
      s.saldoReservado += x;
      if (s.saldoReservado > s.saldoFisico) throw new Error('CHECK peca_saldos_reservado_valido');
      log.push('saldo');
      return 1;
    }),
    pecaSaldo: {
      findUniqueOrThrow: jest.fn(async ({ where }: { where: { pecaId_depositoId: { pecaId: string; depositoId: string } } }) => {
        const s = saldos.get(`${where.pecaId_depositoId.pecaId}|${where.pecaId_depositoId.depositoId}`);
        if (!s) throw new Error('P2025');
        return { ...s };
      }),
    },
    serviceOrder: {
      findFirst: jest.fn(async ({ where }: { where: { id: string; companyId: string } }) =>
        where.id === os.id && where.companyId === os.companyId ? { ...os } : null,
      ),
      findFirstOrThrow: jest.fn(async ({ where }: { where: { id: string; companyId: string } }) => {
        if (where.id !== os.id || where.companyId !== os.companyId) throw new Error('P2025');
        return { ...os };
      }),
      updateMany: jest.fn(async ({ where, data }: { where: { id: string; companyId: string }; data: Linha }) => {
        if (where.id !== os.id || where.companyId !== os.companyId) return { count: 0 };
        Object.assign(os, data);
        log.push('os');
        return { count: 1 };
      }),
    },
    peca: {
      findFirst: jest.fn(async ({ where }: { where: { id: string; companyId: string; ativo: boolean } }) => {
        const p = pecas.get(where.id);
        return p && p.companyId === where.companyId && p.ativo === where.ativo ? { id: p.id } : null;
      }),
      findFirstOrThrow: jest.fn(async ({ where }: { where: { id: string; companyId: string } }) => {
        const p = pecas.get(where.id);
        if (!p || p.companyId !== where.companyId) throw new Error('P2025');
        return { ...p };
      }),
    },
    deposito: {
      findFirst: jest.fn(async ({ where, orderBy }: { where: { companyId: string; ativo: boolean }; orderBy: { createdAt: string } }) => {
        if (orderBy?.createdAt !== 'asc') naoReconhecido('deposito.findFirst', orderBy);
        const d = depositos.filter((x) => x.companyId === where.companyId && x.ativo === where.ativo)
          .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())[0];
        return d ? { id: d.id } : null;
      }),
    },
    requisicaoMaterial: {
      findFirst: jest.fn(async ({ where }: { where: Linha }) => {
        const candidatas = [...reqs.values()]
          .filter((r) => r.companyId === where.companyId && r.serviceOrderId === where.serviceOrderId)
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
        if (where.status?.notIn) {
          const r = candidatas.find((x) => !where.status.notIn.includes(x.status));
          return r ? { id: r.id } : null;
        }
        if (where.status?.not) {
          const r = candidatas.find((x) => x.status !== where.status.not);
          return r ? { depositoId: r.depositoId } : null;
        }
        return naoReconhecido('requisicaoMaterial.findFirst', where);
      }),
      findUniqueOrThrow: jest.fn(async ({ where }: { where: { id: string } }) => {
        const r = reqs.get(where.id);
        if (!r) throw new Error('P2025');
        return { ...r };
      }),
      findMany: jest.fn(async ({ where }: { where: { companyId: string; numero: { startsWith: string } } }) =>
        [...reqs.values()].filter((r) => r.companyId === where.companyId && r.numero.startsWith(where.numero.startsWith))
          .map((r) => ({ numero: r.numero })),
      ),
      create: jest.fn(async ({ data }: { data: Linha }) => {
        const r = { id: `req-nova-${++seqReq}`, status: 'pendente', createdAt: new Date(), ...data };
        reqs.set(r.id, r);
        return { id: r.id, numero: r.numero, status: r.status, depositoId: r.depositoId };
      }),
      updateMany: jest.fn(async ({ where, data }: { where: { id: string; status: string }; data: Linha }) => {
        const r = reqs.get(where.id);
        if (!r || r.status !== where.status) return { count: 0 };
        Object.assign(r, data);
        return { count: 1 };
      }),
    },
    requisicaoMaterialItem: {
      create: jest.fn(async ({ data }: { data: Linha }) => {
        const i = { id: `it-novo-${++seqItem}`, ...data };
        itens.set(i.id, i);
        return { id: i.id };
      }),
      findMany: jest.fn(async ({ where }: { where: { requisicaoId: string } }) =>
        [...itens.values()].filter((i) => i.requisicaoId === where.requisicaoId).map((i) => ({ ...i })),
      ),
    },
    solicitacaoCompra: {
      findMany: jest.fn(async () => scs.map((s) => ({ numero: s.numero }))),
      create: jest.fn(async ({ data }: { data: Linha }) => {
        const sc = { id: `sc-${scs.length + 1}`, ...data, itens: data.itens.create };
        scs.push(sc);
        return { id: sc.id, numero: sc.numero };
      }),
    },
    solicitacaoCompraItem: {
      findMany: jest.fn(async ({ where }: { where: Linha }) => {
        if (!where.requisicaoItemId?.in) naoReconhecido('solicitacaoCompraItem.findMany', where);
        // Nenhuma SC deste fake tem OC: cobertura zero.
        return scs.flatMap((s) => s.itens)
          .filter((i: Linha) => where.requisicaoItemId.in.includes(i.requisicaoItemId))
          .map((i: Linha) => ({ requisicaoItemId: i.requisicaoItemId, origensOc: [] }));
      }),
    },
    equipmentProgramador: {
      findMany: jest.fn(async ({ where }: { where: { equipmentId: string } }) =>
        where.equipmentId === 'eq-1' ? [{ companyUserId: 'cu-prog' }] : [],
      ),
    },
    companyRole: {
      findMany: jest.fn(async ({ where }: { where: Linha }) => {
        if (where.companyId !== COMPANY) return [];
        const key = where.accessGroups.some.group.key;
        return key === 'almoxarifado' ? [{ id: 'role-alm' }] : key === 'compras' ? [{ id: 'role-comp' }] : [];
      }),
    },
    operator: {
      findMany: jest.fn(async ({ where }: { where: Linha }) => [
        ...(where.companyRoleId.in.includes('role-alm') ? [{ companyUserId: 'cu-alm' }] : []),
        ...(where.companyRoleId.in.includes('role-comp') ? [{ companyUserId: 'cu-comp' }] : []),
      ]),
    },
    company: { findUnique: jest.fn(async () => ({ legacyId: 'leg-1' })) },
    companyUser: {
      findFirst: jest.fn(async ({ where }: { where: { id: string; companyId: string } }) =>
        where.id === AUTOR && where.companyId === COMPANY ? { name: 'Mecânico', email: 'mec@vrental.com' } : null,
      ),
    },
    pontoAuditoria: { create: jest.fn(async ({ data }: { data: Linha }) => { auditoria.push({ ...data }); return data; }) },
    notificacao: { createMany: jest.fn(async () => { log.push('notificacao'); return { count: 1 }; }) },
    $transaction: jest.fn(),
  };

  let tentativas = 0;
  db.$transaction.mockImplementation(async (fn: (tx: typeof db) => Promise<unknown>) => {
    tentativas += 1;
    if (opts.colisaoNaPrimeira && tentativas === 1) {
      // Outra transação criou a requisição aberta da OS e commitou primeiro.
      reqs.set('req-rival', {
        // Em `dep-2`, não no depósito padrão que a leitura de fora escolheu.
        id: 'req-rival', companyId: COMPANY, serviceOrderId: 'os-1', depositoId: 'dep-2', numero: 'REQ-2026-009',
        status: 'pendente', createdAt: new Date(),
      });
      throw new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002', clientVersion: '7.9.1', meta: { target: 'requisicoes_material_uma_aberta_por_os' },
      });
    }
    const r = await fn(db);
    log.push('commit');
    return r;
  });

  return { servico: new AlmoxarifadoService(db as never), db, estado };
}

function pedir(servico: AlmoxarifadoService, parcial: Partial<Parameters<AlmoxarifadoService['pedirPecaAdicional']>[0]> = {}) {
  return servico.pedirPecaAdicional({
    companyId: COMPANY, serviceOrderId: 'os-1', autorCompanyUserId: AUTOR,
    pecaId: 'p-1', quantidade: 3, impeditivo: false, motivo: 'Correia rachada na desmontagem', ...parcial,
  });
}

const itensAdicionais = (e: Estado) => [...e.itens.values()].filter((i) => i.origem === 'peca_adicional');

describe('pedirPecaAdicional — o que fica gravado', () => {
  beforeEach(() => verificouReposicao.mockClear());

  it('verifica o estoque mínimo depois do commit, no depósito da requisição', async () => {
    const { servico, estado, db } = montar();
    verificouReposicao.mockImplementation(async () => {
      estado.log.push('minimo');
      return { criadas: 0, falhas: 0 };
    });

    await pedir(servico);

    expect(verificouReposicao.mock.calls[0][1]).toEqual([
      { companyId: COMPANY, pecaId: 'p-1', depositoId: 'dep-2' },
    ]);
    expect(verificouReposicao.mock.calls[0][0]).toBe(db);
    expect(estado.log.slice(-3)).toEqual(['commit', 'notificacao', 'minimo']);
    verificouReposicao.mockImplementation(async () => ({ criadas: 0, falhas: 0 }));
  });

  it('pedido que virou falta inteira não mexe no disponível e não verifica o mínimo', async () => {
    const { servico } = montar({ saldo: null });

    await pedir(servico);

    expect(verificouReposicao).not.toHaveBeenCalled();
  });

  it('estoque cobre: reserva, grava o item peça adicional, reabre o kit, OS volta à separação, avisa e deixa rastro', async () => {
    const { servico, estado } = montar();

    const r = await pedir(servico);

    expect(estado.saldos.get('p-1|dep-2')).toEqual({ saldoFisico: 5, saldoReservado: 4 });
    const [item] = itensAdicionais(estado);
    expect(item).toMatchObject({
      requisicaoId: 'req-1', pecaId: 'p-1', descricao: 'Correia', codigoPeca: 'ALM-000007',
      quantidadeSolicitada: 3, quantidadeReservada: 3, status: 'reservada', impeditivo: false, prioridade: 'alta',
      origem: 'peca_adicional', motivo: 'Correia rachada na desmontagem', solicitadoPorCompanyUserId: AUTOR,
    });
    expect(estado.reqs.get('req-1')!.status).toBe('em_separacao');
    expect(estado.os.statusMateriais).toBe('aguardando_separacao');
    expect(estado.scs).toEqual([]);
    expect(estado.auditoria).toEqual([expect.objectContaining({
      companyId: COMPANY, acao: 'requisicao.peca_adicional', alvoTipo: 'suprimentos.requisicao', alvoId: 'req-1',
      atorId: AUTOR, motivo: 'Correia rachada na desmontagem',
    })]);
    expect(r).toEqual({
      requisicaoId: 'req-1', numero: 'REQ-2026-001', itemId: item.id, status: 'reservada',
      quantidadeReservada: 3, quantidadeFaltante: 0, statusMateriais: 'aguardando_separacao', solicitacaoCompra: null,
    });
    const enviadas = (servico as unknown as { prisma: { notificacao: { createMany: jest.Mock } } })
      .prisma.notificacao.createMany.mock.calls[0][0].data as Linha[];
    expect(enviadas.map((n) => [n.destinatarioId, n.titulo])).toEqual([
      ['cu-prog', 'OS-2026-047: peça adicional pedida'],
      ['cu-alm', 'Peça adicional na REQ-2026-001'],
    ]);
  });

  it('estoque parcial: reserva o livre, a falta vira SC peça adicional crítica, o kit NÃO reabre, OS aguarda a peça e Compras é avisado', async () => {
    const { servico, estado, db } = montar({ saldo: { fisico: 5, reservado: 3 } });

    const r = await pedir(servico, { quantidade: 5, impeditivo: true });

    expect(estado.saldos.get('p-1|dep-2')).toEqual({ saldoFisico: 5, saldoReservado: 5 });
    const [item] = itensAdicionais(estado);
    expect(item).toMatchObject({ status: 'faltante', quantidadeSolicitada: 5, quantidadeReservada: 2, prioridade: 'critica' });
    expect(estado.scs).toEqual([expect.objectContaining({
      companyId: COMPANY, numero: 'SC-2026-001', origem: 'peca_adicional', prioridade: 'critica', depositoId: 'dep-2',
      serviceOrderId: 'os-1', requisicaoId: 'req-1', solicitanteCompanyUserId: AUTOR,
      itens: [expect.objectContaining({ pecaId: 'p-1', quantidade: 3, requisicaoItemId: item.id, prioridade: 'critica' })],
    })]);
    expect(estado.reqs.get('req-1')!.status).toBe('separada');
    expect(estado.os.statusMateriais).toBe('aguardando_peca_adicional');
    expect(r).toMatchObject({ status: 'faltante', quantidadeReservada: 2, quantidadeFaltante: 3, solicitacaoCompra: 'SC-2026-001' });
    const enviadas = db.notificacao.createMany.mock.calls[0][0].data as Linha[];
    expect(enviadas.map((n) => [n.destinatarioId, n.titulo])).toEqual([
      ['cu-prog', 'OS-2026-047: peça adicional pedida'],
      ['cu-alm', 'Peça adicional na REQ-2026-001'],
      ['cu-comp', 'Solicitação SC-2026-001 crítica'],
    ]);
  });

  it('com falta do plano ainda sem compra, a OS continua aguardando compra', async () => {
    const { servico, estado } = montar({ saldo: null, faltaDoPlanoDescoberta: true });
    await pedir(servico);
    expect(estado.os.statusMateriais).toBe('aguardando_compra');
  });

  it('requisição da OS já entregue: abre requisição nova no mesmo depósito e não mexe na entregue', async () => {
    const { servico, estado } = montar({ statusRequisicao: 'entregue' });

    const r = await pedir(servico);

    expect(r).toMatchObject({ numero: 'REQ-2026-002', status: 'reservada' });
    const nova = estado.reqs.get(r.requisicaoId)!;
    expect(nova).toMatchObject({ serviceOrderId: 'os-1', depositoId: 'dep-2', companyId: COMPANY, solicitanteCompanyUserId: AUTOR });
    expect(itensAdicionais(estado)[0].requisicaoId).toBe(r.requisicaoId);
    expect(estado.reqs.get('req-1')!.status).toBe('entregue');
    expect(estado.log).not.toContain('trava:req:req-1');
    expect(estado.saldos.get('p-1|dep-2')!.saldoReservado).toBe(4);
  });

  it('OS sem requisição nenhuma: depósito ativo mais antigo; sem saldo lá, tudo é falta e o saldo não é tocado', async () => {
    const { servico, estado } = montar({ statusRequisicao: null });

    const r = await pedir(servico);

    expect(estado.reqs.get(r.requisicaoId)!.depositoId).toBe('dep-1');
    expect(r).toMatchObject({ status: 'faltante', quantidadeReservada: 0, quantidadeFaltante: 3 });
    expect(estado.log).not.toContain('saldo');
    expect(estado.saldos.get('p-1|dep-2')!.saldoReservado).toBe(1);
  });

  it('requisição fechada entre a leitura e a trava: relê e abre outra', async () => {
    const { servico, estado } = montar({
      aoTravarRequisicao: (e) => { e.reqs.get('req-1')!.status = 'entregue'; },
    });

    const r = await pedir(servico);

    expect(r.requisicaoId).not.toBe('req-1');
    expect(r.numero).toBe('REQ-2026-002');
    expect(estado.reqs.get('req-1')!.status).toBe('entregue');
  });

  it('trava a requisição antes do saldo e grava a OS por último, antes do commit; avisa depois do commit', async () => {
    const { servico, estado } = montar();
    await pedir(servico);
    expect(estado.log).toEqual(['trava:req:req-1', 'trava:saldo:p-1|dep-2', 'saldo', 'os', 'commit', 'notificacao']);
  });

  it('UPDATE condicionado do saldo que não grava: lança e não cria item', async () => {
    const { servico, estado } = montar({ guardaDoSaldoFalha: true });
    await expect(pedir(servico)).rejects.toBeInstanceOf(ConflictException);
    expect(itensAdicionais(estado)).toEqual([]);
  });

  it('perdeu a corrida no índice de requisição aberta: tenta de novo e acrescenta na requisição que venceu', async () => {
    const { servico, estado, db } = montar({ statusRequisicao: null, colisaoNaPrimeira: true });

    const r = await pedir(servico);

    expect(db.$transaction).toHaveBeenCalledTimes(2);
    expect(r.requisicaoId).toBe('req-rival');
    // O mínimo é conferido no depósito da requisição que venceu (`dep-2`), não
    // no que a leitura de fora escolheu quando não havia requisição (`dep-1`).
    expect(verificouReposicao.mock.calls[0][1]).toEqual([
      { companyId: COMPANY, pecaId: 'p-1', depositoId: 'dep-2' },
    ]);
    expect(itensAdicionais(estado).map((i) => i.requisicaoId)).toEqual(['req-rival']);
    // Reserva no depósito da requisição relida, não no que a leitura de fora escolheu.
    expect(r.status).toBe('reservada');
    expect(estado.saldos.get('p-1|dep-2')!.saldoReservado).toBe(4);
  });
});

describe('pedirPecaAdicional — recusas antes da transação', () => {
  it.each([
    ['quantidade zero', { quantidade: 0 }, BadRequestException],
    ['quantidade NaN', { quantidade: Number.NaN }, BadRequestException],
    ['motivo em branco', { motivo: '   ' }, BadRequestException],
    ['OS de outra empresa', { companyId: OUTRA }, NotFoundException],
  ])('%s', async (_nome, parcial, erro) => {
    const { servico, db } = montar();
    await expect(pedir(servico, parcial as never)).rejects.toBeInstanceOf(erro);
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it.each([
    ['OS de execução parceira', { os: { execucao: 'parceira' } }, ConflictException],
    ['OS concluída', { os: { situacao: 'Concluida' } }, ConflictException],
    ['OS com materiais cancelados', { os: { statusMateriais: 'cancelada' } }, ConflictException],
    ['peça inativa', { pecaAtiva: false }, NotFoundException],
    ['sem depósito ativo', { statusRequisicao: null, semDeposito: true }, ConflictException],
  ])('%s', async (_nome, opts, erro) => {
    const { servico, db } = montar(opts as Opcoes);
    await expect(pedir(servico)).rejects.toBeInstanceOf(erro);
    expect(db.$transaction).not.toHaveBeenCalled();
  });
});

describe('listarPecasAdicionais', () => {
  it('filtra por empresa, OS e origem', async () => {
    const findMany = jest.fn(async () => []);
    const servico = new AlmoxarifadoService({ requisicaoMaterialItem: { findMany } } as never);
    await servico.listarPecasAdicionais(COMPANY, 'os-1');
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { origem: 'peca_adicional', requisicao: { companyId: COMPANY, serviceOrderId: 'os-1' } },
    }));
  });
});
