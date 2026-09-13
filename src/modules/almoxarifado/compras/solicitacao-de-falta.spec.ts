import { abrirSolicitacaoDasFaltas, cancelarSolicitacoesDasFaltas } from './solicitacao-de-falta';

const COMPANY = '11111111-1111-1111-1111-111111111111';

function txFalso(numerosExistentes: string[] = []) {
  return {
    solicitacaoCompra: {
      findMany: jest.fn(async ({ where }: { where: { companyId: string; numero: { startsWith: string } } }) =>
        numerosExistentes
          .filter((n) => where.companyId === COMPANY && n.startsWith(where.numero.startsWith))
          .map((numero) => ({ numero })),
      ),
      create: jest.fn(async ({ data }: { data: { numero: string } }) => ({ id: 'sc-1', numero: data.numero })),
    },
  };
}

const entrada = (faltas: Array<{ requisicaoItemId: string; pecaId: string; quantidade: number; impeditivo: boolean }>) => ({
  companyId: COMPANY, depositoId: 'dep-1', serviceOrderId: 'os-1', requisicaoId: 'req-1',
  solicitanteCompanyUserId: 'user-1', origem: 'falta_os' as const,
  dataNecessidade: new Date('2026-09-20T00:00:00Z'), faltas,
});

describe('abrirSolicitacaoDasFaltas', () => {
  it('um item por falta, apontando para o item de requisição, com a quantidade que falta', async () => {
    const tx = txFalso();
    await abrirSolicitacaoDasFaltas(tx as never, entrada([
      { requisicaoItemId: 'ri-1', pecaId: 'p-1', quantidade: 2, impeditivo: false },
      { requisicaoItemId: 'ri-2', pecaId: 'p-2', quantidade: 1, impeditivo: false },
    ]));
    const data = (tx.solicitacaoCompra.create.mock.calls[0] as unknown as [{ data: Record<string, any> }])[0].data;
    expect(data).toMatchObject({
      companyId: COMPANY, origem: 'falta_os', prioridade: 'alta', depositoId: 'dep-1',
      serviceOrderId: 'os-1', requisicaoId: 'req-1', solicitanteCompanyUserId: 'user-1',
    });
    expect(data.itens.create).toEqual([
      { pecaId: 'p-1', quantidade: 2, requisicaoItemId: 'ri-1', prioridade: 'alta', dataNecessidade: new Date('2026-09-20T00:00:00Z') },
      { pecaId: 'p-2', quantidade: 1, requisicaoItemId: 'ri-2', prioridade: 'alta', dataNecessidade: new Date('2026-09-20T00:00:00Z') },
    ]);
  });

  it('falta de item impeditivo é crítica — no item e no cabeçalho', async () => {
    const tx = txFalso();
    const r = await abrirSolicitacaoDasFaltas(tx as never, entrada([
      { requisicaoItemId: 'ri-1', pecaId: 'p-1', quantidade: 2, impeditivo: false },
      { requisicaoItemId: 'ri-2', pecaId: 'p-2', quantidade: 1, impeditivo: true },
    ]));
    expect(r?.prioridade).toBe('critica');
    const data = (tx.solicitacaoCompra.create.mock.calls[0] as unknown as [{ data: Record<string, any> }])[0].data;
    expect(data.prioridade).toBe('critica');
    expect(data.itens.create.map((i: { prioridade: string }) => i.prioridade)).toEqual(['alta', 'critica']);
  });

  it('o número continua a sequência do ano pelo MAIOR em número', async () => {
    const tx = txFalso(['SC-2026-009', 'SC-2026-010', 'SC-2025-999']);
    const ano = new Date().getUTCFullYear();
    const r = await abrirSolicitacaoDasFaltas(tx as never, entrada([
      { requisicaoItemId: 'ri-1', pecaId: 'p-1', quantidade: 2, impeditivo: false },
    ]));
    expect(r?.numero).toBe(ano === 2026 ? 'SC-2026-011' : `SC-${ano}-001`);
  });

  it('sem falta com quantidade, não abre solicitação nenhuma', async () => {
    const tx = txFalso();
    const r = await abrirSolicitacaoDasFaltas(tx as never, entrada([
      { requisicaoItemId: 'ri-1', pecaId: 'p-1', quantidade: 0, impeditivo: true },
    ]));
    expect(r).toBeNull();
    expect(tx.solicitacaoCompra.create).not.toHaveBeenCalled();
  });
});

describe('cancelarSolicitacoesDasFaltas', () => {
  type Origem = { quantidade: number; quantidadeRecebida: number; ordemCompraItem: { ordemCompra: { numero: string; status: string } } };

  /** Banco falso que PERSISTE: itens e cabeçalhos mudam de estado entre leituras. */
  function banco() {
    const itens: Array<{ id: string; solicitacaoId: string; requisicaoItemId: string; status: string; quantidade: number; companyId: string; origensOc: Origem[] }> = [
      { id: 'sci-1', solicitacaoId: 'sc-1', requisicaoItemId: 'ri-1', status: 'aberta', quantidade: 2, companyId: COMPANY,
        origensOc: [{ quantidade: 2, quantidadeRecebida: 0, ordemCompraItem: { ordemCompra: { numero: 'OC-2026-003', status: 'emitida' } } }] },
      { id: 'sci-2', solicitacaoId: 'sc-2', requisicaoItemId: 'ri-2', status: 'aberta', quantidade: 1, companyId: COMPANY, origensOc: [] },
      // Mesma SC, falta de OUTRA requisição: continua viva.
      { id: 'sci-3', solicitacaoId: 'sc-2', requisicaoItemId: 'ri-outra', status: 'aberta', quantidade: 1, companyId: COMPANY, origensOc: [] },
      // Item de solicitação de OUTRA empresa com o mesmo id de item de requisição.
      { id: 'sci-x', solicitacaoId: 'sc-x', requisicaoItemId: 'ri-1', status: 'aberta', quantidade: 5, companyId: 'outra', origensOc: [] },
    ];
    const cabecalhos: Record<string, { numero: string; status: string; motivo: string | null; canceladaPor: string | null }> = {
      'sc-1': { numero: 'SC-2026-001', status: 'aprovada', motivo: null, canceladaPor: null },
      'sc-2': { numero: 'SC-2026-002', status: 'pendente', motivo: null, canceladaPor: null },
      'sc-x': { numero: 'SC-2026-001', status: 'pendente', motivo: null, canceladaPor: null },
    };
    const chamadas: string[] = [];
    const tx = {
      $queryRaw: jest.fn(async (q: { text: string; values: unknown[] }) => {
        chamadas.push(`LOCK ${JSON.stringify(q.values[0])}`);
        return [];
      }),
      solicitacaoCompraItem: {
        findMany: jest.fn(async ({ where }: { where: any }) =>
          itens
            .filter((i) => !where.requisicaoItemId || where.requisicaoItemId.in.includes(i.requisicaoItemId))
            .filter((i) => !where.id || where.id.in.includes(i.id))
            .filter((i) => !where.status || i.status === where.status)
            .filter((i) => !where.solicitacao?.companyId || i.companyId === where.solicitacao.companyId)
            .map((i) => ({ id: i.id, solicitacaoId: i.solicitacaoId, origensOc: i.origensOc })),
        ),
        updateMany: jest.fn(async ({ where, data }: { where: any; data: any }) => {
          chamadas.push('UPDATE itens');
          let count = 0;
          for (const i of itens) {
            if (where.id.in.includes(i.id) && i.status === where.status) { i.status = data.status; count++; }
          }
          return { count };
        }),
      },
      solicitacaoCompra: {
        findUniqueOrThrow: jest.fn(async ({ where }: { where: { id: string } }) => ({
          numero: cabecalhos[where.id].numero,
          status: cabecalhos[where.id].status,
          itens: itens.filter((i) => i.solicitacaoId === where.id)
            .map((i) => ({ status: i.status, quantidade: i.quantidade, origensOc: i.origensOc })),
        })),
        updateMany: jest.fn(async ({ where, data }: { where: any; data: any }) => {
          const c = cabecalhos[where.id];
          const casa = where.status?.notIn ? !where.status.notIn.includes(c.status) : c.status === where.status;
          if (!casa) return { count: 0 };
          c.status = data.status;
          if (data.motivoCancelamento) c.motivo = data.motivoCancelamento;
          if (data.canceladaPorCompanyUserId) c.canceladaPor = data.canceladaPorCompanyUserId;
          return { count: 1 };
        }),
      },
    };
    return { tx, itens, cabecalhos, chamadas };
  }

  const cancelar = (tx: unknown, requisicaoItemIds: string[]) =>
    cancelarSolicitacoesDasFaltas(tx as never, {
      companyId: COMPANY, requisicaoItemIds, autorCompanyUserId: 'user-1', motivo: 'Requisição REQ-2026-001 cancelada: engano',
    });

  it('cancela só os itens vivos das faltas desta empresa, travando antes de escrever', async () => {
    const { tx, itens, chamadas } = banco();
    await cancelar(tx, ['ri-1', 'ri-2']);
    const status = Object.fromEntries(itens.map((i) => [i.id, i.status]));
    expect(status).toEqual({ 'sci-1': 'cancelada', 'sci-2': 'cancelada', 'sci-3': 'aberta', 'sci-x': 'aberta' });
    expect(chamadas[0]).toBe('LOCK ["sci-1","sci-2"]');
    expect(chamadas.indexOf('UPDATE itens')).toBeGreaterThan(0);
  });

  it('solicitação com todos os itens cancelados é cancelada com o motivo; a que tem item vivo só recalcula', async () => {
    const { tx, cabecalhos } = banco();
    await cancelar(tx, ['ri-1', 'ri-2']);
    expect(cabecalhos['sc-1']).toMatchObject({
      status: 'cancelada', motivo: 'Requisição REQ-2026-001 cancelada: engano', canceladaPor: 'user-1',
    });
    expect(cabecalhos['sc-2'].status).toBe('pendente');
  });

  it('devolve em que ordens de compra havia unidade de cada solicitação cancelada', async () => {
    const { tx } = banco();
    expect(await cancelar(tx, ['ri-1', 'ri-2'])).toEqual([
      { solicitacaoId: 'sc-1', numero: 'SC-2026-001', ordensDeCompra: ['OC-2026-003'] },
      { solicitacaoId: 'sc-2', numero: 'SC-2026-002', ordensDeCompra: [] },
    ]);
  });

  it('sem item vivo para as faltas, não trava nem escreve nada', async () => {
    const { tx, chamadas } = banco();
    expect(await cancelar(tx, ['ri-inexistente'])).toEqual([]);
    expect(chamadas).toEqual([]);
  });
});
