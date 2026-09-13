import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { AlmoxarifadoService } from './almoxarifado.service';

const COMPANY = '11111111-1111-1111-1111-111111111111';
const OUTRA = '99999999-9999-9999-9999-999999999999';
const REQ = '33333333-3333-3333-3333-333333333333';
const AUTOR = '44444444-4444-4444-4444-444444444444';

type Linha = Record<string, any>;

interface Opcoes {
  statusRequisicao?: string;
  /** Item `it-1` com outro estado que não `entregue`. */
  statusDoItem?: string;
  /** Quanto do `it-1` já voltou antes desta devolução. */
  jaDevolvido?: number;
  /** Segunda peça entregue, para provar a ordem de trava. */
  segundaPeca?: boolean;
  /** A OS não tem insumo lançado pela entrega (kit importado, lançamento manual). */
  semInsumoDaEntrega?: boolean;
}

/**
 * Banco fake que PERSISTE e filtra pelos `where` da produção; `where` não
 * reconhecido lança, para nenhum teste passar por um mock que devolve tudo.
 */
function montar(opts: Opcoes = {}) {
  const log: string[] = [];
  const requisicao = {
    id: REQ, companyId: COMPANY, numero: 'REQ-2026-001', status: opts.statusRequisicao ?? 'entregue',
    depositoId: 'dep-1', serviceOrderId: 'os-1',
  };
  const itens = new Map<string, Linha>([
    ['it-1', {
      id: 'it-1', requisicaoId: REQ, pecaId: 'p-2', status: opts.statusDoItem ?? 'entregue',
      quantidadeEntregue: 5, quantidadeDevolvida: opts.jaDevolvido ?? 0,
    }],
  ]);
  if (opts.segundaPeca) {
    itens.set('it-2', {
      id: 'it-2', requisicaoId: REQ, pecaId: 'p-1', status: 'entregue',
      quantidadeEntregue: 3, quantidadeDevolvida: 0,
    });
  }
  const saldos = new Map<string, Linha>([
    ['p-1|dep-1', { saldoFisico: 4 }],
    ['p-2|dep-1', { saldoFisico: 1 }],
  ]);
  const pecas = new Map<string, Linha>([
    ['p-1', { id: 'p-1', companyId: COMPANY, codigoInterno: 'ALM-000001', descricao: 'Filtro de óleo', marca: 'Mann', unidade: 'un', custoMedio: 31 }],
    ['p-2', { id: 'p-2', companyId: COMPANY, codigoInterno: 'ALM-000002', descricao: 'Correia', marca: null, unidade: 'un', custoMedio: 44 }],
  ]);
  // O que a ENTREGA lançou na OS: é de lá que sai o valor do crédito.
  const insumos: Linha[] = opts.semInsumoDaEntrega
    ? []
    : [
        { serviceOrderId: 'os-1', ordem: 0, codigo: 'ALM-000001', quantidade: 3, valorUnit: 28 },
        { serviceOrderId: 'os-1', ordem: 1, codigo: 'ALM-000002', quantidade: 5, valorUnit: 40 },
      ];
  const movimentos: Linha[] = [];
  const auditoria: Linha[] = [];
  const estado = { log, requisicao, itens, saldos, pecas, insumos, movimentos, auditoria };

  const naoReconhecido = (onde: string, arg: unknown): never => {
    throw new Error(`${onde}: where não reconhecido neste fake — ${JSON.stringify(arg)}`);
  };

  const db = {
    $queryRaw: jest.fn(async (q: { text: string; values: unknown[] }) => {
      const v = q.values;
      if (q.text.includes('FROM requisicoes_material')) {
        log.push('trava:req');
        const filtra = q.text.includes('company_id');
        return requisicao.id === v[0] && (!filtra || requisicao.companyId === v[1]) ? [{ id: REQ }] : [];
      }
      if (q.text.includes('FROM peca_saldos')) {
        log.push(`trava:saldo:${v[0]}`);
        return saldos.has(`${v[0]}|${v[1]}`) ? [{ peca_id: v[0] }] : [];
      }
      throw new Error(`SQL não reconhecido: ${q.text}`);
    }),
    $executeRaw: jest.fn(async (q: { text: string; values: unknown[] }) => {
      if (!q.text.includes('UPDATE peca_saldos')) throw new Error(`SQL não reconhecido: ${q.text}`);
      // Lê o OPERADOR no próprio SQL: um fake de sinal fixo não veria um `-`
      // escrito no lugar do `+`.
      const sinal = /saldo_fisico\s*=\s*saldo_fisico\s*([+-])/.exec(q.text)?.[1];
      if (!sinal) throw new Error(`UPDATE de saldo fora do formato: ${q.text}`);
      const [quantidade, pecaId, depositoId] = q.values as [number, string, string];
      const s = saldos.get(`${pecaId}|${depositoId}`);
      if (!s) return 0;
      s.saldoFisico += (sinal === '+' ? 1 : -1) * quantidade;
      if (s.saldoFisico < 0) throw new Error('CHECK peca_saldos_fisico_nao_negativo');
      log.push(`saldo:${pecaId}`);
      return 1;
    }),
    requisicaoMaterial: {
      findFirst: jest.fn(async ({ where }: { where: { id: string; companyId: string } }) =>
        where.id === requisicao.id && where.companyId === requisicao.companyId
          ? { id: requisicao.id, status: requisicao.status }
          : null,
      ),
      findUniqueOrThrow: jest.fn(async ({ where }: { where: { id: string } }) => {
        if (where.id !== requisicao.id) throw new Error('P2025');
        return { ...requisicao };
      }),
    },
    requisicaoMaterialItem: {
      findMany: jest.fn(async ({ where }: { where: Linha }) => {
        if (!where.id?.in || !where.requisicaoId) return naoReconhecido('requisicaoMaterialItem.findMany', where);
        return [...itens.values()]
          .filter((i) => where.id.in.includes(i.id) && i.requisicaoId === where.requisicaoId)
          .map((i) => ({ ...i }));
      }),
      updateMany: jest.fn(async ({ where, data }: { where: { id: string; status: string }; data: Linha }) => {
        const i = itens.get(where.id);
        if (!i || i.status !== where.status) return { count: 0 };
        i.quantidadeDevolvida += data.quantidadeDevolvida.increment;
        if (i.quantidadeDevolvida > i.quantidadeEntregue) throw new Error('CHECK req_item_devolvida_ate_entregue');
        return { count: 1 };
      }),
    },
    pecaSaldo: {
      findUniqueOrThrow: jest.fn(async ({ where }: { where: { pecaId_depositoId: { pecaId: string; depositoId: string } } }) => {
        const s = saldos.get(`${where.pecaId_depositoId.pecaId}|${where.pecaId_depositoId.depositoId}`);
        if (!s) throw new Error('P2025');
        return { ...s };
      }),
    },
    peca: {
      findFirstOrThrow: jest.fn(async ({ where }: { where: { id: string; companyId: string } }) => {
        const p = pecas.get(where.id);
        if (!p || p.companyId !== where.companyId) throw new Error('P2025');
        return { ...p };
      }),
    },
    serviceOrderInsumo: {
      count: jest.fn(async ({ where }: { where: { serviceOrderId: string } }) =>
        insumos.filter((i) => i.serviceOrderId === where.serviceOrderId).length,
      ),
      findFirst: jest.fn(async ({ where }: { where: Linha }) => {
        if (where.quantidade?.gt !== 0) return naoReconhecido('serviceOrderInsumo.findFirst', where);
        const achados = insumos
          .filter((i) => i.serviceOrderId === where.serviceOrderId && i.codigo === where.codigo && i.quantidade > 0)
          .sort((a, b) => b.ordem - a.ordem);
        return achados[0] ? { valorUnit: achados[0].valorUnit } : null;
      }),
      create: jest.fn(async ({ data }: { data: Linha }) => {
        insumos.push({ ...data });
        log.push('insumo');
        return data;
      }),
    },
    estoqueMovimento: {
      create: jest.fn(async ({ data }: { data: Linha }) => {
        movimentos.push({ ...data });
        return data;
      }),
    },
    companyUser: {
      findFirst: jest.fn(async ({ where }: { where: { id: string; companyId: string } }) =>
        where.id === AUTOR && where.companyId === COMPANY ? { name: 'Almoxarife', email: 'alm@vrental.com' } : null,
      ),
    },
    pontoAuditoria: {
      create: jest.fn(async ({ data }: { data: Linha }) => {
        auditoria.push({ ...data });
        return data;
      }),
    },
    $transaction: jest.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
      const r = await fn(db);
      log.push('commit');
      return r;
    }),
  };

  return { servico: new AlmoxarifadoService(db as never), db, estado };
}

const devolver = (
  servico: AlmoxarifadoService,
  parcial: Partial<Parameters<AlmoxarifadoService['devolverSobra']>[0]> = {},
) =>
  servico.devolverSobra({
    companyId: COMPANY,
    requisicaoId: REQ,
    autorCompanyUserId: AUTOR,
    motivo: 'Sobrou uma correia na troca',
    itens: [{ itemId: 'it-1', quantidade: 2 }],
    ...parcial,
  });

describe('devolverSobra — o que fica gravado', () => {
  it('a peça volta ao físico, o item registra o devolvido, o razão ganha a devolução e a OS é creditada', async () => {
    const { servico, estado } = montar();

    const r = await devolver(servico, { recebidoDe: 'João (mecânico)' });

    expect(estado.saldos.get('p-2|dep-1')).toEqual({ saldoFisico: 3 });
    expect(estado.itens.get('it-1')).toMatchObject({ quantidadeDevolvida: 2, status: 'entregue' });
    expect(estado.movimentos).toEqual([expect.objectContaining({
      companyId: COMPANY, pecaId: 'p-2', depositoId: 'dep-1', tipo: 'devolucao', quantidade: 2,
      saldoApos: 3, custoUnit: null, origemTipo: 'devolucao_requisicao', origemId: REQ,
      autorCompanyUserId: AUTOR, observacao: 'Sobrou uma correia na troca (de João (mecânico))',
    })]);
    // Crédito na OS pelo valor que a ENTREGA cobrou (40), não pelo custo médio de hoje (44).
    expect(estado.insumos.at(-1)).toMatchObject({
      serviceOrderId: 'os-1', codigo: 'ALM-000002', descricao: 'Devolução — Correia',
      quantidade: -2, valorUnit: 40, ordem: 2,
    });
    expect(estado.auditoria).toEqual([expect.objectContaining({
      companyId: COMPANY, acao: 'requisicao.devolver_sobra', alvoTipo: 'suprimentos.requisicao',
      alvoId: REQ, atorId: AUTOR, motivo: 'Sobrou uma correia na troca',
    })]);
    expect(r).toEqual({
      requisicaoId: REQ, numero: 'REQ-2026-001',
      itens: [{ itemId: 'it-1', pecaId: 'p-2', quantidade: 2, quantidadeDevolvidaTotal: 2 }],
    });
  });

  it('devolução não mexe no custo médio da peça — volta sem nota', async () => {
    const { servico, estado, db } = montar();

    await devolver(servico);

    expect(estado.pecas.get('p-2')!.custoMedio).toBe(44);
    expect(db.estoqueMovimento.create.mock.calls[0][0].data.custoUnit).toBeNull();
  });

  it('sem insumo lançado pela entrega, credita pelo custo médio atual', async () => {
    const { servico, estado } = montar({ semInsumoDaEntrega: true });

    await devolver(servico);

    expect(estado.insumos.at(-1)).toMatchObject({ quantidade: -2, valorUnit: 44, ordem: 0 });
  });

  it('trava a requisição antes do saldo e devolve peça a peça na ordem de trava', async () => {
    const { servico, estado } = montar({ segundaPeca: true });

    await devolver(servico, {
      itens: [{ itemId: 'it-1', quantidade: 1 }, { itemId: 'it-2', quantidade: 3 }],
    });

    // `it-1` é da peça `p-2` e vem depois de `p-1` na ordem única de trava,
    // apesar de vir primeiro no pedido.
    expect(estado.log.filter((l) => l.startsWith('trava') || l.startsWith('saldo'))).toEqual([
      'trava:req', 'trava:saldo:p-1', 'saldo:p-1', 'trava:saldo:p-2', 'saldo:p-2',
    ]);
    expect(estado.saldos.get('p-1|dep-1')).toEqual({ saldoFisico: 7 });
    expect(estado.saldos.get('p-2|dep-1')).toEqual({ saldoFisico: 2 });
  });

  it('o que já voltou antes não volta de novo: só o resto pode ser devolvido', async () => {
    const { servico, estado } = montar({ jaDevolvido: 4 });

    await devolver(servico, { itens: [{ itemId: 'it-1', quantidade: 1 }] });
    expect(estado.itens.get('it-1')!.quantidadeDevolvida).toBe(5);

    await expect(devolver(servico, { itens: [{ itemId: 'it-1', quantidade: 1 }] }))
      .rejects.toBeInstanceOf(BadRequestException);
  });

  it('devolver mais do que saiu é recusado sem gravar nada', async () => {
    const { servico, estado } = montar();

    await expect(devolver(servico, { itens: [{ itemId: 'it-1', quantidade: 6 }] }))
      .rejects.toThrow(/restam 5/);

    expect(estado.saldos.get('p-2|dep-1')).toEqual({ saldoFisico: 1 });
    expect(estado.movimentos).toEqual([]);
    expect(estado.insumos).toHaveLength(2);
  });

  it('peça que nunca saiu do depósito não tem o que devolver', async () => {
    const { servico, estado } = montar({ statusDoItem: 'reservada' });

    await expect(devolver(servico)).rejects.toBeInstanceOf(ConflictException);
    expect(estado.movimentos).toEqual([]);
  });

  it('item de outra requisição é recusado', async () => {
    const { servico } = montar();
    await expect(devolver(servico, { itens: [{ itemId: 'it-de-outra', quantidade: 1 }] }))
      .rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('devolverSobra — recusas antes da transação', () => {
  it.each([
    ['motivo em branco', { motivo: '   ' }, BadRequestException],
    ['sem itens', { itens: [] }, BadRequestException],
    ['quantidade zero', { itens: [{ itemId: 'it-1', quantidade: 0 }] }, BadRequestException],
    ['quantidade NaN', { itens: [{ itemId: 'it-1', quantidade: Number.NaN }] }, BadRequestException],
    ['item repetido', { itens: [{ itemId: 'it-1', quantidade: 1 }, { itemId: 'it-1', quantidade: 1 }] }, BadRequestException],
    ['requisição de outra empresa', { companyId: OUTRA }, NotFoundException],
  ])('%s', async (_nome, parcial, erro) => {
    const { servico, db } = montar();
    await expect(devolver(servico, parcial as never)).rejects.toBeInstanceOf(erro);
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it('requisição cancelada não recebe devolução', async () => {
    const { servico, db } = montar({ statusRequisicao: 'cancelada' });
    await expect(devolver(servico)).rejects.toBeInstanceOf(ConflictException);
    expect(db.$transaction).not.toHaveBeenCalled();
  });
});
