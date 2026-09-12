import { ConflictException } from '@nestjs/common';
import { AlmoxarifadoService } from './almoxarifado.service';
import { Prisma } from '../../prisma/generated/client';

const COMPANY = '11111111-1111-1111-1111-111111111111';
const REQ = '33333333-3333-3333-3333-333333333333';
const AUTOR = '44444444-4444-4444-4444-444444444444';
const MECANICO = '55555555-5555-5555-5555-555555555555';

/** Fabrica o erro de deadlock/conflito de escrita que aciona o retry (`erroDeContencaoTransitoria`). */
function erroDeContencao(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError(
    'Transaction failed due to a write conflict or a deadlock. Please retry your transaction',
    { code: 'P2034', clientVersion: '7.9.1' },
  );
}

/**
 * Um "banco" falso, chave por id de item — mesmo molde de
 * `separacao-servico.spec.ts`: `itensDb` é o que `findUniqueOrThrow` lê
 * DEPOIS da trava, e pode ser adulterado nos testes para divergir do
 * retrato de `itens` (o que `requisicaoMaterial.findFirst` devolve, lido
 * FORA da transação) — é essa divergência que prova que o serviço decrementa
 * o saldo pelo valor FRESCO, não pelo que leu antes de abrir a transação.
 */
function montar(status: string, itens: Array<Record<string, unknown>>, opts: { semSaldo?: boolean } = {}) {
  const chamadas: string[] = [];
  const itensDb = new Map(itens.map((i) => [i.id as string, { ...i }]));

  const tx = {
    $queryRaw: jest.fn(async () => {
      chamadas.push('LOCK');
      if (opts.semSaldo) return [];
      return [{ saldo_fisico: '10', saldo_reservado: '4', saldo_separado: '4' }];
    }),
    $executeRaw: jest.fn(async () => {
      chamadas.push('UPDATE saldo');
      return 1;
    }),
    requisicaoMaterial: {
      findFirst: jest.fn().mockResolvedValue({
        id: REQ, companyId: COMPANY, status, serviceOrderId: 'os-1',
        depositoId: 'dep-1', itens,
      }),
      update: jest.fn(async () => { chamadas.push('UPDATE requisicao'); return {}; }),
    },
    requisicaoMaterialItem: {
      // A leitura FRESCA de dentro da transação — chave da correção do
      // Achado 1 desta task (ver `executarEntrega`): sem isto, o serviço
      // teria de decrementar o saldo com `item.quantidadeSeparada` lido de
      // fora da transação, o mesmo defeito já corrigido duas vezes antes
      // (entrada de estoque, conferência do kit).
      findUniqueOrThrow: jest.fn(async ({ where: { id } }: { where: { id: string } }) => {
        const atual = itensDb.get(id);
        if (!atual) throw new Error(`item ${id} não existe (mock)`);
        return { ...atual };
      }),
      update: jest.fn(async ({ where: { id }, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        chamadas.push('UPDATE item');
        const atualizado = { ...(itensDb.get(id) ?? {}), ...data };
        itensDb.set(id, atualizado);
        return atualizado;
      }),
    },
    estoqueMovimento: {
      create: jest.fn(async (a: { data: { quantidade: number; tipo: string } }) => {
        chamadas.push(`MOVIMENTO ${a.data.tipo} ${a.data.quantidade}`);
        return {};
      }),
    },
    serviceOrderInsumo: {
      create: jest.fn(async () => { chamadas.push('INSUMO'); return {}; }),
    },
    serviceOrder: {
      updateMany: jest.fn(async () => { chamadas.push('UPDATE os'); return { count: 1 }; }),
    },
    peca: {
      findFirstOrThrow: jest.fn().mockResolvedValue({
        custoMedio: 25, descricao: 'Filtro de óleo', codigoInterno: 'ALM-000001',
        marca: 'JCB', unidade: 'un',
      }),
    },
  };
  const prisma = {
    $transaction: jest.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
    // A leitura da requisição (para validar o estado antes de abrir a
    // transação) usa `this.prisma`, não `tx` — igual a um `PrismaService` de
    // verdade, em que o mesmo delegate de modelo atende fora e dentro de
    // `$transaction`.
    requisicaoMaterial: tx.requisicaoMaterial,
  };
  return { servico: new AlmoxarifadoService(prisma as never), prisma, tx, chamadas, itensDb };
}

const separado = () => ({
  id: 'it-1', pecaId: 'p-1', quantidadeReservada: 4, quantidadeSeparada: 4,
  quantidadeEntregue: 0, status: 'separada', impeditivo: true, divergencia: null,
  descricao: 'Filtro de óleo', codigoPeca: '32925682',
});

describe('liberarRequisicao', () => {
  it('kit separado libera a OS para execução', async () => {
    const { servico } = montar('separada', [separado()]);
    const r = await servico.liberarRequisicao({
      companyId: COMPANY, requisicaoId: REQ, autorCompanyUserId: AUTOR,
    });
    expect(r.statusMateriais).toBe('liberada_para_execucao');
  });

  it('kit ainda em separação NÃO libera', async () => {
    // É a regra central: receber não é separar, e separar não é liberar.
    const { servico } = montar('em_separacao', [separado()]);
    await expect(servico.liberarRequisicao({
      companyId: COMPANY, requisicaoId: REQ, autorCompanyUserId: AUTOR,
    })).rejects.toBeInstanceOf(ConflictException);
  });

  it('grava liberadaEm e liberadaPorCompanyUserId, sem tocar em saldo', async () => {
    const { servico, tx, chamadas } = montar('separada', [separado()]);
    await servico.liberarRequisicao({
      companyId: COMPANY, requisicaoId: REQ, autorCompanyUserId: AUTOR,
    });
    const dados = tx.requisicaoMaterial.update.mock.calls[0][0].data as {
      liberadaEm: Date; liberadaPorCompanyUserId: string;
    };
    expect(dados.liberadaEm).toBeInstanceOf(Date);
    expect(dados.liberadaPorCompanyUserId).toBe(AUTOR);
    // Nenhuma chamada de saldo — liberar é ato administrativo, não físico.
    expect(chamadas).not.toContain('LOCK');
    expect(chamadas).not.toContain('UPDATE saldo');
  });

  it('carrega os dados que a Task 8 precisa para notificar (protocolo, equipamento, depósito)', async () => {
    // TODO(Task 8): esta é a garantia de que `notificarOsLiberada` vai achar
    // tudo que precisa sem uma segunda consulta — a chamada em si ainda não
    // existe (comentada em `liberarRequisicao`, aguardando a Task 8).
    const { servico, prisma } = montar('separada', [separado()]);
    await servico.liberarRequisicao({
      companyId: COMPANY, requisicaoId: REQ, autorCompanyUserId: AUTOR,
    });
    const chamada = (prisma.requisicaoMaterial.findFirst as jest.Mock).mock.calls[0][0] as {
      include: { deposito: { select: Record<string, boolean> }; serviceOrder: { select: Record<string, boolean> } };
    };
    expect(chamada.include.deposito.select.nome).toBe(true);
    expect(chamada.include.serviceOrder.select).toEqual({
      protocolo: true, equipmentId: true, equipmentNome: true, responsavelOperatorId: true,
    });
  });
});

describe('entregarRequisicao', () => {
  it('a saída do razão é NEGATIVA', async () => {
    // `quantidade` em estoque_movimentos é com sinal: conferir o saldo é um SUM.
    const { servico, chamadas } = montar('separada', [separado()]);
    await servico.entregarRequisicao({
      companyId: COMPANY, requisicaoId: REQ, autorCompanyUserId: AUTOR,
      recebedorOperatorId: MECANICO, confirmacaoTipo: 'pin',
    });
    expect(chamadas).toContain('MOVIMENTO saida -4');
  });

  it('trava antes de mexer no saldo', async () => {
    const { servico, chamadas } = montar('separada', [separado()]);
    await servico.entregarRequisicao({
      companyId: COMPANY, requisicaoId: REQ, autorCompanyUserId: AUTOR,
      recebedorOperatorId: MECANICO, confirmacaoTipo: 'pin',
    });
    expect(chamadas[0]).toBe('LOCK');
  });

  it('grava o insumo na OS — é o que a auditoria de OS lê', async () => {
    const { servico, tx } = montar('separada', [separado()]);
    await servico.entregarRequisicao({
      companyId: COMPANY, requisicaoId: REQ, autorCompanyUserId: AUTOR,
      recebedorOperatorId: MECANICO, confirmacaoTipo: 'pin',
    });
    const insumo = tx.serviceOrderInsumo.create.mock.calls[0][0].data;
    expect(insumo.serviceOrderId).toBe('os-1');
    expect(Number(insumo.quantidade)).toBe(4);
    expect(Number(insumo.valorUnit)).toBe(25);
  });

  it('requisição não separada não pode ser entregue', async () => {
    const { servico } = montar('pendente', [separado()]);
    await expect(servico.entregarRequisicao({
      companyId: COMPANY, requisicaoId: REQ, autorCompanyUserId: AUTOR,
      recebedorOperatorId: MECANICO, confirmacaoTipo: 'pin',
    })).rejects.toBeInstanceOf(ConflictException);
  });

  it('entregar duas vezes é recusado', async () => {
    const { servico } = montar('entregue', [separado()]);
    await expect(servico.entregarRequisicao({
      companyId: COMPANY, requisicaoId: REQ, autorCompanyUserId: AUTOR,
      recebedorOperatorId: MECANICO, confirmacaoTipo: 'pin',
    })).rejects.toBeInstanceOf(ConflictException);
  });

  // --- Achados desta revisão (regras do coordenador, "valem mais que o brief") ---

  it('decrementa saldo_fisico, saldo_reservado e saldo_separado com aritmética RELATIVA, e trava com FOR UPDATE', async () => {
    // A FORMA da escrita, não só o alvo: sem isto, nada impede voltar a
    // calcular o absoluto em JavaScript e ainda assim citar as três colunas
    // no texto (foi exatamente o defeito do rascunho original desta tarefa —
    // `saldo_fisico` vinha como valor JS, só `saldo_reservado`/
    // `saldo_separado` eram relativos).
    const { servico, tx } = montar('separada', [separado()]);
    await servico.entregarRequisicao({
      companyId: COMPANY, requisicaoId: REQ, autorCompanyUserId: AUTOR,
      recebedorOperatorId: MECANICO, confirmacaoTipo: 'pin',
    });
    const lock = tx.$queryRaw.mock.calls[0][0] as { text: string };
    expect(lock.text).toMatch(/FOR UPDATE/i);
    expect(lock.text).toContain('saldo_fisico');

    const atualiza = tx.$executeRaw.mock.calls[0][0] as { text: string };
    expect(atualiza.text).toMatch(/saldo_fisico\s*=\s*saldo_fisico\s*-/);
    expect(atualiza.text).toMatch(/saldo_reservado\s*=\s*saldo_reservado\s*-/);
    expect(atualiza.text).toMatch(/saldo_separado\s*=\s*saldo_separado\s*-/);
  });

  it('decrementa pela quantidade FRESCA (relida na transação), não pelo retrato de fora dela', async () => {
    // Achado central desta task: `itens` (o que `findFirst` devolve fora da
    // transação) mostra `quantidadeSeparada: 4` — mas o "banco" (`itensDb`,
    // relido por `findUniqueOrThrow` DEPOIS da trava) já está em 2, simulando
    // uma reconferência concorrente que reduziu o kit nesse meio-tempo. Se o
    // serviço decrementasse pelo retrato de fora (4), o razão e o saldo
    // ficariam errados por 2 unidades — o mesmo defeito já corrigido na
    // entrada de estoque e na conferência do kit, desta vez na entrega.
    const { servico, tx, itensDb, chamadas } = montar('separada', [separado()]);
    itensDb.set('it-1', { ...separado(), quantidadeSeparada: 2 });

    await servico.entregarRequisicao({
      companyId: COMPANY, requisicaoId: REQ, autorCompanyUserId: AUTOR,
      recebedorOperatorId: MECANICO, confirmacaoTipo: 'pin',
    });

    expect(chamadas).toContain('MOVIMENTO saida -2');
    const atualiza = tx.$executeRaw.mock.calls[0][0] as { values: unknown[] };
    expect(atualiza.values).toContain(2);
    expect(atualiza.values).not.toContain(4);
    const insumo = tx.serviceOrderInsumo.create.mock.calls[0][0].data;
    expect(Number(insumo.quantidade)).toBe(2);
    expect(Number(itensDb.get('it-1')?.quantidadeEntregue)).toBe(2);
  });

  it('trava peca_saldos em ordem por pecaId, não pela ordem dos itens da requisição', async () => {
    const { servico, tx } = montar('separada', [
      { ...separado(), id: 'it-2', pecaId: 'p-2' },
      { ...separado(), id: 'it-1', pecaId: 'p-1' },
    ]);
    await servico.entregarRequisicao({
      companyId: COMPANY, requisicaoId: REQ, autorCompanyUserId: AUTOR,
      recebedorOperatorId: MECANICO, confirmacaoTipo: 'pin',
    });
    // Se a ordenação por pecaId for removida num refactor futuro, este teste
    // falha: sem ela, duas entregas simultâneas travando as mesmas linhas em
    // ordens opostas dão deadlock (40P01), não um erro de aplicação normal.
    const ordem = tx.requisicaoMaterialItem.update.mock.calls.map(
      (c: [{ where: { id: string } }]) => c[0].where.id,
    );
    expect(ordem).toEqual(['it-1', 'it-2']);
  });

  it('sem linha de saldo falha alto, em vez de assumir zero', async () => {
    // Mesmo raciocínio do Important M1 de `separarItens`: `FOR UPDATE` não
    // trava linha inexistente — silenciar deixaria o item marcado como
    // entregue sem o saldo ter mexido. Falha com um erro cru (não
    // `ConflictException`): é estado inconsistente com a separação, não uma
    // recusa de negócio normal.
    const { servico } = montar('separada', [separado()], { semSaldo: true });
    let capturado: unknown;
    try {
      await servico.entregarRequisicao({
        companyId: COMPANY, requisicaoId: REQ, autorCompanyUserId: AUTOR,
        recebedorOperatorId: MECANICO, confirmacaoTipo: 'pin',
      });
    } catch (erro) {
      capturado = erro;
    }
    expect(capturado).toBeInstanceOf(Error);
    expect(capturado).not.toBeInstanceOf(ConflictException);
    expect((capturado as Error).message).toMatch(/inconsistente/);
  });

  it('grava status entregue e os dados de recebimento na requisição', async () => {
    const { servico, tx } = montar('separada', [separado()]);
    await servico.entregarRequisicao({
      companyId: COMPANY, requisicaoId: REQ, autorCompanyUserId: AUTOR,
      recebedorOperatorId: MECANICO, confirmacaoTipo: 'pin', assinatura: 'traço',
    });
    const dados = tx.requisicaoMaterial.update.mock.calls.find(
      (c: [{ data: { status?: string } }]) => c[0].data.status === 'entregue',
    )?.[0].data as {
      status: string; entregueEm: Date; entreguePorCompanyUserId: string;
      recebedorOperatorId: string; confirmacaoTipo: string; assinatura: string | null;
    };
    expect(dados.status).toBe('entregue');
    expect(dados.entregueEm).toBeInstanceOf(Date);
    expect(dados.entreguePorCompanyUserId).toBe(AUTOR);
    expect(dados.recebedorOperatorId).toBe(MECANICO);
    expect(dados.confirmacaoTipo).toBe('pin');
    expect(dados.assinatura).toBe('traço');
  });

  it('contenção transitória aciona o retry da transação inteira', async () => {
    const { servico, tx, prisma } = montar('separada', [separado()]);
    let tentativas = 0;
    const lockOriginal = tx.$queryRaw.getMockImplementation()!;
    tx.$queryRaw = jest.fn(async (...args: unknown[]) => {
      tentativas++;
      if (tentativas === 1) throw erroDeContencao();
      return lockOriginal(...(args as []));
    });
    const r = await servico.entregarRequisicao({
      companyId: COMPANY, requisicaoId: REQ, autorCompanyUserId: AUTOR,
      recebedorOperatorId: MECANICO, confirmacaoTipo: 'pin',
    });
    expect(tentativas).toBe(2);
    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
    expect(r.statusMateriais).toBe('liberada_para_execucao');
  });

  it('esgotar as tentativas por contenção vira ConflictException, não 500 cru', async () => {
    const { servico, tx, prisma } = montar('separada', [separado()]);
    tx.$queryRaw = jest.fn(async () => { throw erroDeContencao(); });
    await expect(servico.entregarRequisicao({
      companyId: COMPANY, requisicaoId: REQ, autorCompanyUserId: AUTOR,
      recebedorOperatorId: MECANICO, confirmacaoTipo: 'pin',
    })).rejects.toThrow(ConflictException);
    // MAX_TENTATIVAS_CONCORRENCIA no serviço é 5 — mesmo teto usado pela
    // reserva e pela separação.
    expect(prisma.$transaction).toHaveBeenCalledTimes(5);
  });

  it('statusAposEntrega: item faltante ao lado do entregue manda comprar, não libera', async () => {
    // Prova que `statusAposEntrega` é usada de verdade (não só chamada) nos
    // dois caminhos possíveis desta função.
    const { servico } = montar('separada', [
      separado(),
      { ...separado(), id: 'it-2', pecaId: 'p-2', status: 'faltante', quantidadeSeparada: 0 },
    ]);
    const r = await servico.entregarRequisicao({
      companyId: COMPANY, requisicaoId: REQ, autorCompanyUserId: AUTOR,
      recebedorOperatorId: MECANICO, confirmacaoTipo: 'pin',
    });
    expect(r.statusMateriais).toBe('aguardando_compra');
  });
});
