import { AlmoxarifadoService } from './almoxarifado.service';

const COMPANY = '11111111-1111-1111-1111-111111111111';
const REQ = '33333333-3333-3333-3333-333333333333';
const AUTOR = '44444444-4444-4444-4444-444444444444';
const MECANICO = '55555555-5555-5555-5555-555555555555';

/**
 * Fundação da F4 — a "segunda rodada" de uma requisição, ponta a ponta, pelo
 * que fica GRAVADO.
 *
 * Cenário: preventiva com um impeditivo em estoque (`it-1`) e um não
 * impeditivo que só tinha 3 de 5 (`it-2`). O kit fecha pelo impeditivo, é
 * liberado e entregue — a requisição fica ABERTA por causa do `it-2` (achado
 * I7). A compra chega (simulada aqui do jeito que o recebimento da F4 grava:
 * reserva do item completa, item `reservada`, requisição de volta a
 * `em_separacao`), o almoxarife confere a peça nova, e a segunda entrega fecha
 * a requisição.
 *
 * Duas mudanças da fundação decidem se isso anda:
 * - a entrega mantém a reserva parcial do faltante — sem ela, o `it-2` sai da
 *   primeira entrega com reserva 0 e a falta vira 5;
 * - `requisicaoEstaSeparada` conta `entregue` como resolvido — sem ela, a
 *   reconferência do `it-2` nunca fecha o kit (o `it-1` está `entregue`, não
 *   `separada`) e a segunda entrega é recusada para sempre.
 *
 * Banco fake que PERSISTE entre chamadas, no molde de
 * `separacao-status-persistido.spec.ts`. O saldo não é o foco aqui (as
 * contas de `peca_saldos` têm testes próprios em `entrega.spec.ts` e
 * `separacao-servico.spec.ts`): a trava de saldo devolve uma linha folgada.
 */
function montarBancoFake(coberturaDaFalta: Array<{ requisicaoItemId: string; origensOc: Array<Record<string, unknown>> }> = []) {
  const requisicao = {
    id: REQ,
    companyId: COMPANY,
    status: 'separada',
    serviceOrderId: 'os-1',
    depositoId: 'dep-1',
    numero: 'REQ-2026-001',
    liberadaEm: new Date('2026-09-13T09:00:00Z') as Date | null,
    liberadaPorCompanyUserId: AUTOR as string | null,
    atendidaPorCompanyUserId: null as string | null,
    atendidaEm: null as Date | null,
    entregueEm: null as Date | null,
    entreguePorCompanyUserId: null as string | null,
    recebedorOperatorId: null as string | null,
    confirmacaoTipo: null as string | null,
    assinatura: null as string | null,
  };

  const itens = new Map<string, Record<string, unknown>>([
    ['it-1', {
      id: 'it-1', requisicaoId: REQ, pecaId: 'p-1', quantidadeSolicitada: 4,
      quantidadeReservada: 4, quantidadeSeparada: 4, quantidadeEntregue: 0,
      status: 'separada', impeditivo: true, divergencia: null,
    }],
    ['it-2', {
      id: 'it-2', requisicaoId: REQ, pecaId: 'p-2', quantidadeSolicitada: 5,
      quantidadeReservada: 3, quantidadeSeparada: 0, quantidadeEntregue: 0,
      status: 'faltante', impeditivo: false, divergencia: null,
    }],
  ]);

  const os = { statusMateriais: 'aguardando_compra' };

  const tx = {
    $queryRaw: jest.fn(async (query: { text: string }) => {
      if (query.text.includes('requisicoes_material')) return [{ id: REQ }];
      return [{ saldo_fisico: '50', saldo_reservado: '20', saldo_separado: '20' }];
    }),
    $executeRaw: jest.fn(async () => 1),
    requisicaoMaterial: {
      findFirst: jest.fn(async () => ({
        ...requisicao,
        itens: [...itens.values()].map((i) => ({ ...i })),
        serviceOrder: {
          protocolo: 'OS-2026-047', equipmentId: null, equipmentNome: null, responsavelOperatorId: null,
        },
        deposito: { nome: 'Almoxarifado Central' },
      })),
      findUniqueOrThrow: jest.fn(async () => ({ ...requisicao })),
      // As três formas de `where` condicionado que a produção usa: fechamento
      // da entrega (`status: 'separada'`), fechamento do kit
      // (`status: { not: 'separada' }`) e liberação (`liberadaEm: null`). Cada
      // uma só grava quando a condição bate contra o estado ATUAL.
      updateMany: jest.fn(async ({ where, data }: {
        where: { id: string; status?: string | { not: string }; liberadaEm?: null };
        data: Record<string, unknown>;
      }) => {
        if (typeof where.status === 'string') {
          if (requisicao.status !== where.status) return { count: 0 };
        } else if (where.status !== undefined) {
          if (requisicao.status === where.status.not) return { count: 0 };
        } else if (where.liberadaEm !== undefined) {
          if (requisicao.liberadaEm !== null) return { count: 0 };
        } else {
          throw new Error('where não reconhecido neste fake — atualize o teste');
        }
        Object.assign(requisicao, data);
        return { count: 1 };
      }),
      update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        Object.assign(requisicao, data);
        return { ...requisicao };
      }),
    },
    requisicaoMaterialItem: {
      findMany: jest.fn(async () => [...itens.values()].map((i) => ({ ...i }))),
      findUniqueOrThrow: jest.fn(async ({ where: { id } }: { where: { id: string } }) => {
        const atual = itens.get(id);
        if (!atual) throw new Error(`item ${id} não existe (mock)`);
        return { ...atual };
      }),
      update: jest.fn(async ({ where: { id }, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        itens.set(id, { ...(itens.get(id) ?? {}), ...data });
        return { ...itens.get(id) };
      }),
    },
    peca: {
      findFirstOrThrow: jest.fn(async () => ({
        custoMedio: 25, descricao: 'Peça', codigoInterno: 'ALM-000001', marca: null, unidade: 'un',
      })),
    },
    estoqueMovimento: { create: jest.fn(async () => ({})) },
    serviceOrderInsumo: { create: jest.fn(async () => ({})), count: jest.fn(async () => 0) },
    // F4: a cobertura da falta pela compra (`refinarPelaCompra`). Filtra pelo
    // `requisicaoItemId in` que a produção manda — um fake que devolvesse tudo
    // não provaria que é a falta DESTA requisição que foi olhada.
    solicitacaoCompraItem: {
      findMany: jest.fn(async ({ where }: { where: { requisicaoItemId: { in: string[] } } }) =>
        (coberturaDaFalta ?? []).filter((c) => where.requisicaoItemId.in.includes(c.requisicaoItemId)),
      ),
    },
    serviceOrder: {
      updateMany: jest.fn(async ({ data }: { data: { statusMateriais: string } }) => {
        os.statusMateriais = data.statusMateriais;
        return { count: 1 };
      }),
    },
    // Notificação sem destinatário nos caminhos daqui — coberta em
    // `almoxarifado-notificacoes.spec.ts` e nas suítes de cada método.
    companyRole: { findMany: jest.fn(async () => []) },
    operator: { findMany: jest.fn(async () => []), findFirst: jest.fn(async () => null) },
    equipmentProgramador: { findMany: jest.fn(async () => []) },
    company: { findUnique: jest.fn(async () => ({ legacyId: 'leg-1' })) },
    notificacao: { createMany: jest.fn(async () => ({ count: 1 })) },
  };

  const prisma = {
    $transaction: jest.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
    requisicaoMaterial: tx.requisicaoMaterial,
    operator: { findFirst: jest.fn(async () => ({ id: MECANICO })) },
    notificacao: { createMany: jest.fn(async () => ({ count: 1 })) },
  };

  return { servico: new AlmoxarifadoService(prisma as never), requisicao, itens, os };
}

function entregar(servico: AlmoxarifadoService) {
  return servico.entregarRequisicao({
    companyId: COMPANY, requisicaoId: REQ, autorCompanyUserId: AUTOR,
    recebedorOperatorId: MECANICO, confirmacaoTipo: 'pin',
  });
}

describe('fundação F4 — a segunda rodada de uma requisição, pelo que fica gravado', () => {
  it('a primeira entrega leva o impeditivo e deixa o faltante parcial COM a reserva dele', async () => {
    const { servico, requisicao, itens, os } = montarBancoFake();

    await entregar(servico);

    expect(itens.get('it-1')).toMatchObject({ status: 'entregue', quantidadeEntregue: 4 });
    expect(itens.get('it-2')).toMatchObject({ status: 'faltante', quantidadeReservada: 3 });
    expect(requisicao.status).toBe('separada');
    expect(os.statusMateriais).toBe('aguardando_compra');
  });

  it('com a falta do it-2 já a caminho numa OC emitida, a primeira entrega grava compra_em_andamento na OS', async () => {
    const { servico, os } = montarBancoFake([{ requisicaoItemId: 'it-2', origensOc: [{ quantidade: 2, quantidadeRecebida: 0, ordemCompraItem: { ordemCompra: { status: 'emitida' } } }] }]);

    await entregar(servico);

    expect(os.statusMateriais).toBe('compra_em_andamento');
  });

  it('a peça que chega é conferida, o kit FECHA de novo com o impeditivo já entregue, e a segunda entrega fecha a requisição', async () => {
    const { servico, requisicao, itens, os } = montarBancoFake();
    await entregar(servico);

    // O que o recebimento da F4 grava quando a compra do `it-2` chega.
    itens.set('it-2', { ...itens.get('it-2'), quantidadeReservada: 5, status: 'reservada' });
    requisicao.status = 'em_separacao';

    const conferencia = await servico.separarItens({
      companyId: COMPANY, requisicaoId: REQ, autorCompanyUserId: AUTOR,
      itens: [{ itemId: 'it-2', quantidade: 5 }],
    });
    expect(conferencia.statusRequisicao).toBe('separada');
    expect(requisicao.status).toBe('separada');
    expect(os.statusMateriais).toBe('materiais_separados');

    await entregar(servico);

    expect(itens.get('it-2')).toMatchObject({ status: 'entregue', quantidadeEntregue: 5 });
    expect(requisicao.status).toBe('entregue');
    expect(os.statusMateriais).toBe('liberada_para_execucao');
  });
});
