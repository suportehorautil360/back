import { faltasComCobertura, recalcularStatusDeCompraDaOs, refinarPelaCompra } from './cobertura';

type ItemSc = {
  requisicaoItemId: string;
  status: string;
  origensOc: Array<{ quantidade: number; quantidadeRecebida: number; statusOc: string }>;
};

/**
 * Fake que FILTRA de verdade por `requisicaoItemId in` e `status not` — um
 * mock que devolvesse sempre todas as linhas não provaria que item de
 * solicitação cancelado fica de fora.
 */
function txFalso(itensSc: ItemSc[]) {
  return {
    solicitacaoCompraItem: {
      findMany: jest.fn(async ({ where }: {
        where: { requisicaoItemId: { in: string[] }; status?: { not: string } };
      }) =>
        itensSc
          .filter((i) => where.requisicaoItemId.in.includes(i.requisicaoItemId))
          .filter((i) => where.status?.not === undefined || i.status !== where.status.not)
          .map((i) => ({
            requisicaoItemId: i.requisicaoItemId,
            origensOc: i.origensOc.map((o) => ({
              quantidade: o.quantidade,
              quantidadeRecebida: o.quantidadeRecebida,
              ordemCompraItem: { ordemCompra: { status: o.statusOc } },
            })),
          })),
      ),
    },
  };
}

const faltante = (id: string, solicitada: number, reservada: number) => ({
  id, status: 'faltante', quantidadeSolicitada: solicitada, quantidadeReservada: reservada,
});

describe('faltasComCobertura', () => {
  it('soma as origens de todas as OCs do item e ignora item de solicitação cancelado', async () => {
    const tx = txFalso([
      { requisicaoItemId: 'ri1', status: 'aberta', origensOc: [{ quantidade: 2, quantidadeRecebida: 0, statusOc: 'emitida' }] },
      // Cancelado: a origem dele NÃO cobre a falta, mesmo numa OC emitida.
      { requisicaoItemId: 'ri1', status: 'cancelada', origensOc: [{ quantidade: 5, quantidadeRecebida: 0, statusOc: 'emitida' }] },
    ]);
    const faltas = await faltasComCobertura(tx as never, [faltante('ri1', 5, 3)]);
    expect(faltas).toEqual([{ falta: 2, cobertura: { emCotacao: 0, aCaminho: 2, recebido: 0 } }]);
  });

  it('item que não é faltante nem chega a consultar o banco', async () => {
    const tx = txFalso([]);
    const faltas = await faltasComCobertura(tx as never, [
      { id: 'ri1', status: 'reservada', quantidadeSolicitada: 5, quantidadeReservada: 5 },
    ]);
    expect(faltas).toEqual([]);
    expect(tx.solicitacaoCompraItem.findMany).not.toHaveBeenCalled();
  });
});

describe('refinarPelaCompra', () => {
  it('falta coberta por OC emitida vira compra em andamento', async () => {
    const tx = txFalso([
      { requisicaoItemId: 'ri1', status: 'aberta', origensOc: [{ quantidade: 2, quantidadeRecebida: 0, statusOc: 'enviada' }] },
    ]);
    expect(await refinarPelaCompra(tx as never, 'aguardando_compra', [faltante('ri1', 5, 3)]))
      .toBe('compra_em_andamento');
  });

  it('só a cobertura do item cancelado não cobre — continua aguardando compra', async () => {
    const tx = txFalso([
      { requisicaoItemId: 'ri1', status: 'cancelada', origensOc: [{ quantidade: 2, quantidadeRecebida: 0, statusOc: 'emitida' }] },
    ]);
    expect(await refinarPelaCompra(tx as never, 'aguardando_compra', [faltante('ri1', 5, 3)]))
      .toBe('aguardando_compra');
  });

  it('estado que não é de falta volta sem consultar a compra', async () => {
    const tx = txFalso([]);
    expect(await refinarPelaCompra(tx as never, 'materiais_separados', [faltante('ri1', 5, 3)]))
      .toBe('materiais_separados');
    expect(tx.solicitacaoCompraItem.findMany).not.toHaveBeenCalled();
  });
});

describe('recalcularStatusDeCompraDaOs', () => {
  const COMPANY = '11111111-1111-1111-1111-111111111111';

  /** Banco falso: a requisição filtra por id e empresa; a OS guarda o status GRAVADO. */
  function montar(statusDaOs: string, itensSc: ItemSc[]) {
    const os = { statusMateriais: statusDaOs };
    const tx = {
      ...txFalso(itensSc),
      requisicaoMaterial: {
        findFirst: jest.fn(async ({ where }: { where: { id: string; companyId: string } }) =>
          where.id === 'req-1' && where.companyId === COMPANY
            ? { serviceOrderId: 'os-1', serviceOrder: { statusMateriais: os.statusMateriais }, itens: [faltante('ri1', 5, 3)] }
            : null,
        ),
      },
      serviceOrder: {
        updateMany: jest.fn(async ({ where, data }: { where: { id: string; companyId: string }; data: { statusMateriais: string } }) => {
          if (where.id !== 'os-1' || where.companyId !== COMPANY) return { count: 0 };
          os.statusMateriais = data.statusMateriais;
          return { count: 1 };
        }),
      },
    };
    return { tx, os };
  }

  it('OC emitida cobrindo a falta: a OS vai de aguardando compra para compra em andamento', async () => {
    const { tx, os } = montar('aguardando_compra', [
      { requisicaoItemId: 'ri1', status: 'aberta', origensOc: [{ quantidade: 2, quantidadeRecebida: 0, statusOc: 'emitida' }] },
    ]);
    expect(await recalcularStatusDeCompraDaOs(tx as never, { requisicaoId: 'req-1', companyId: COMPANY }))
      .toBe('compra_em_andamento');
    expect(os.statusMateriais).toBe('compra_em_andamento');
  });

  it('OC cancelada tira a cobertura: a OS volta a aguardando compra', async () => {
    const { tx, os } = montar('compra_em_andamento', [
      { requisicaoItemId: 'ri1', status: 'aberta', origensOc: [{ quantidade: 2, quantidadeRecebida: 0, statusOc: 'cancelada' }] },
    ]);
    await recalcularStatusDeCompraDaOs(tx as never, { requisicaoId: 'req-1', companyId: COMPANY });
    expect(os.statusMateriais).toBe('aguardando_compra');
  });

  it('OS fora dos estados de compra não é tocada', async () => {
    const { tx, os } = montar('em_analise_materiais', [
      { requisicaoItemId: 'ri1', status: 'aberta', origensOc: [{ quantidade: 2, quantidadeRecebida: 0, statusOc: 'emitida' }] },
    ]);
    expect(await recalcularStatusDeCompraDaOs(tx as never, { requisicaoId: 'req-1', companyId: COMPANY })).toBeNull();
    expect(os.statusMateriais).toBe('em_analise_materiais');
    expect(tx.serviceOrder.updateMany).not.toHaveBeenCalled();
  });

  it('requisição de outra empresa: nada é lido nem gravado', async () => {
    const { tx } = montar('aguardando_compra', []);
    expect(await recalcularStatusDeCompraDaOs(tx as never, { requisicaoId: 'req-1', companyId: 'outra' })).toBeNull();
    expect(tx.serviceOrder.updateMany).not.toHaveBeenCalled();
  });
});
