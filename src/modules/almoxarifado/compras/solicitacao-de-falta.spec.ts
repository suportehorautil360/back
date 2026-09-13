import { abrirSolicitacaoDasFaltas } from './solicitacao-de-falta';

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
