import { AlmoxarifadoService } from './almoxarifado.service';

const COMPANY = '11111111-1111-1111-1111-111111111111';
const REQ = '33333333-3333-3333-3333-333333333333';
const AUTOR = '44444444-4444-4444-4444-444444444444';
const MECANICO = '55555555-5555-5555-5555-555555555555';

/**
 * Achado Important I7 da revisão final (decisão do produto, 2026-09-13):
 * entregar o que existe, com um item não impeditivo ainda `faltante`, NÃO
 * pode fechar a requisição como `entregue` — isso a tornava terminal
 * (`separarItens`/`entregarRequisicao` recusam, `cancelarRequisicao` também,
 * e o índice único parcial `requisicoes_material_uma_aberta_por_os`
 * continuava contando a linha como "a aberta desta OS"), travando a OS em
 * `aguardando_compra` para sempre — sem a fatia de compras (F4), nada mais
 * preenchia a falta.
 *
 * A prova de verdade aqui exige DUAS chamadas encadeadas no MESMO estado —
 * `entregarRequisicao` (que não pode fechar) e, na sequência,
 * `cancelarRequisicao` (que tem de continuar aceitando essa MESMA
 * requisição: é isso que garante que a OS não fica sem saída nenhuma) — por
 * isso este arquivo usa um banco fake que PERSISTE de verdade entre
 * chamadas, no mesmo molde de `separacao-status-persistido.spec.ts`, em vez
 * do `mockResolvedValue` estático de `entrega.spec.ts` (que não reflete o
 * que uma chamada grava na próxima).
 */
function montarBancoFake() {
  const requisicao = {
    id: REQ,
    companyId: COMPANY,
    status: 'separada',
    serviceOrderId: 'os-1',
    depositoId: 'dep-1',
    numero: 'REQ-2026-001',
    liberadaEm: new Date('2026-09-13T09:00:00Z') as Date | null,
    liberadaPorCompanyUserId: AUTOR as string | null,
    entregueEm: null as Date | null,
    entreguePorCompanyUserId: null as string | null,
    recebedorOperatorId: null as string | null,
    confirmacaoTipo: null as string | null,
    assinatura: null as string | null,
    canceladaEm: null as Date | null,
    canceladaPorCompanyUserId: null as string | null,
    motivoCancelamento: null as string | null,
  };

  // it-1: impeditivo, já conferido e pronto — o que o mecânico VAI levar.
  // it-2: NÃO impeditivo, `faltante` — nunca teve saldo suficiente (o
  // cenário exato do achado I7: uma segunda peça zerada na preventiva).
  const itens = new Map<string, Record<string, unknown>>([
    ['it-1', {
      id: 'it-1', pecaId: 'p-1', quantidadeReservada: 4, quantidadeSeparada: 4,
      quantidadeEntregue: 0, status: 'separada', impeditivo: true, divergencia: null,
    }],
    ['it-2', {
      id: 'it-2', pecaId: 'p-2', quantidadeReservada: 0, quantidadeSeparada: 0,
      quantidadeEntregue: 0, status: 'faltante', impeditivo: false, divergencia: null,
    }],
  ]);

  // Só `p-1` tem linha de saldo — `p-2` nunca teve entrada no depósito,
  // igual ao cenário real do achado I7 (e do I6: `FOR UPDATE` não trava
  // linha que não existe).
  const saldoP1 = { saldo_fisico: '10', saldo_reservado: '4', saldo_separado: '4' };

  const tx = {
    $queryRaw: jest.fn(async (query: { values: unknown[] }) => {
      const pecaId = query.values[0];
      return pecaId === 'p-1' ? [{ ...saldoP1 }] : [];
    }),
    $executeRaw: jest.fn(async () => 1),
    requisicaoMaterial: {
      // Lê o estado ATUAL de `requisicao` a cada chamada — nunca um retrato
      // fixo. É isso que permite `cancelarRequisicao` (chamado depois de
      // `entregarRequisicao`) enxergar o status que a entrega de fato
      // gravou.
      findFirst: jest.fn(async () => ({
        ...requisicao,
        itens: [...itens.values()].map((i) => ({ ...i })),
      })),
      // A releitura FRESCA de `liberadaEm` que `executarEntrega` faz
      // (achado Important I2) — mesma fonte de verdade que `findFirst`.
      findUniqueOrThrow: jest.fn(async () => ({ ...requisicao })),
      // Simula as DUAS formas de `where` que a produção usa para fechar a
      // requisição: `status: 'separada'` (fechamento da ENTREGA, condicional
      // a nada mais estar pendente — achado I7) e
      // `status: { notIn: [...] }` (fechamento do CANCELAMENTO). Cada uma só
      // "casa" — e só então grava — quando a condição bate contra o estado
      // ATUAL, exatamente como um `updateMany` condicional de verdade.
      updateMany: jest.fn(async ({ where, data }: {
        where: { id: string; status: string | { notIn: string[] } };
        data: Record<string, unknown>;
      }) => {
        const statusAtual = requisicao.status;
        const casa = typeof where.status === 'string'
          ? statusAtual === where.status
          : !where.status.notIn.includes(statusAtual);
        if (!casa) return { count: 0 };
        Object.assign(requisicao, data);
        return { count: 1 };
      }),
    },
    requisicaoMaterialItem: {
      findUniqueOrThrow: jest.fn(async ({ where: { id } }: { where: { id: string } }) => {
        const atual = itens.get(id);
        if (!atual) throw new Error(`item ${id} não existe (mock)`);
        return { ...atual };
      }),
      update: jest.fn(async ({ where: { id }, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        itens.set(id, { ...(itens.get(id) ?? {}), ...data });
        return { ...itens.get(id) };
      }),
      // O fechamento em massa do CANCELAMENTO: todo item que não estiver
      // `entregue`/`cancelada` vira `cancelada` — inclusive o `faltante`
      // que sobrou da entrega parcial.
      updateMany: jest.fn(async ({ where, data }: {
        where: { requisicaoId: string; status: { notIn: string[] } };
        data: Record<string, unknown>;
      }) => {
        let count = 0;
        for (const [id, item] of itens) {
          if (!where.status.notIn.includes(item.status as string)) {
            itens.set(id, { ...item, ...data });
            count++;
          }
        }
        return { count };
      }),
      findMany: jest.fn(async () => [...itens.values()].map((i) => ({ ...i }))),
    },
    peca: {
      findFirstOrThrow: jest.fn(async () => ({
        custoMedio: 25, descricao: 'Filtro de óleo', codigoInterno: 'ALM-000001',
        marca: 'JCB', unidade: 'un',
      })),
    },
    estoqueMovimento: { create: jest.fn(async () => ({})) },
    serviceOrderInsumo: {
      create: jest.fn(async () => ({})),
      count: jest.fn(async () => 0),
    },
    serviceOrder: { updateMany: jest.fn(async () => ({ count: 1 })) },
  };

  const prisma = {
    $transaction: jest.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
    requisicaoMaterial: tx.requisicaoMaterial,
  };

  return { servico: new AlmoxarifadoService(prisma as never), requisicao, itens, tx };
}

describe('achado Important I7 — entregar com item faltante NÃO fecha a requisição como entregue', () => {
  it('entrega o que existe, mas o status GRAVADO na requisição continua "separada" — não "entregue"', async () => {
    const { servico, requisicao } = montarBancoFake();

    const r = await servico.entregarRequisicao({
      companyId: COMPANY, requisicaoId: REQ, autorCompanyUserId: AUTOR,
      recebedorOperatorId: MECANICO, confirmacaoTipo: 'pin',
    });

    // A OS continua devendo material — é o que a bancada do mecânico lê.
    expect(r.statusMateriais).toBe('aguardando_compra');
    // O que importa é o BANCO, não a resposta: sem a correção,
    // `requisicao.status` viraria 'entregue' aqui — terminal, travando a OS
    // para sempre (prova completa no teste seguinte).
    expect(requisicao.status).toBe('separada');
    expect(requisicao.entregueEm).toBeNull();
  });

  it('depois da entrega parcial, cancelarRequisicao AINDA aceita — é a válvula de escape que evita a OS travada para sempre', async () => {
    const { servico, requisicao, itens } = montarBancoFake();

    await servico.entregarRequisicao({
      companyId: COMPANY, requisicaoId: REQ, autorCompanyUserId: AUTOR,
      recebedorOperatorId: MECANICO, confirmacaoTipo: 'pin',
    });
    // Pré-condição do teste: sem isto, um teste que passasse por acaso
    // (banco já 'entregue') não provaria nada sobre a válvula de escape.
    expect(requisicao.status).toBe('separada');

    // Antes da correção, a entrega acima já teria fechado a requisição como
    // `entregue` (terminal), e esta chamada rejeitaria com "Requisição
    // entregue não é cancelada — a peça já saiu" — a OS ficaria sem saída
    // nenhuma (nem compra, que não existe nesta fatia, nem cancelamento).
    const r = await servico.cancelarRequisicao({
      companyId: COMPANY, requisicaoId: REQ, autorCompanyUserId: AUTOR,
      motivo: 'peça em falta, sem previsão — cancelar e refazer depois',
    });

    expect(requisicao.status).toBe('cancelada');
    expect(r.statusMateriais).toBe('planejada');
    // O item já entregue não é reescrito pelo cancelamento (a peça já saiu
    // fisicamente) — só o que ainda estava em aberto (`it-2`, faltante)
    // vira cancelada, liberando de vez a OS para uma requisição nova.
    expect(itens.get('it-1')?.status).toBe('entregue');
    expect(itens.get('it-2')?.status).toBe('cancelada');
  });
});
