import { BadRequestException, NotFoundException } from '@nestjs/common';
import { AlmoxarifadoService } from './almoxarifado.service';

const COMPANY = '11111111-1111-1111-1111-111111111111';
const DEPOSITO = '22222222-2222-2222-2222-222222222222';
const OS = '33333333-3333-3333-3333-333333333333';
const AUTOR = '44444444-4444-4444-4444-444444444444';
const PECA = '55555555-5555-5555-5555-555555555555';

/**
 * O `$transaction` falso executa a função recebida com um `tx` que registra
 * as chamadas — é o que permite afirmar que a leitura do saldo e a escrita da
 * reserva acontecem DENTRO da mesma transação, que é a regra inteira.
 */
function prismaFalso(saldoFisico: number, saldoReservado: number) {
  const chamadas: string[] = [];
  const tx = {
    $queryRaw: jest.fn(async () => {
      chamadas.push('SELECT FOR UPDATE');
      return [{ saldo_fisico: saldoFisico, saldo_reservado: saldoReservado }];
    }),
    $executeRaw: jest.fn(async () => {
      chamadas.push('UPDATE saldo');
      return 1;
    }),
    requisicaoMaterial: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn(async () => {
        chamadas.push('INSERT requisicao');
        return { id: 'req-1', numero: 'REQ-2026-001' };
      }),
    },
    requisicaoMaterialItem: {
      create: jest.fn(async () => {
        chamadas.push('INSERT item');
        return {};
      }),
    },
    serviceOrder: {
      update: jest.fn(async () => {
        chamadas.push('UPDATE os');
        return {};
      }),
    },
  };
  const prisma = {
    $transaction: jest.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
    peca: { findMany: jest.fn().mockResolvedValue([]) },
    planoPreventivo: {
      findFirst: jest.fn().mockResolvedValue({
        categorias: [
          {
            id: 'cat-1',
            nome: 'Filtros',
            ciclos: [{ id: 'c1', titulo: 'Ciclo 1' }],
            linhas: [
              { id: 'l1', item: 'Filtro de óleo', codigoPeca: '32925682',
                quantidade: '1', pecaId: 'p-1', impeditivo: true,
                acoes: { c1: 'trocar' } },
            ],
          },
        ],
      }),
    },
    serviceOrder: {
      findFirst: jest.fn().mockResolvedValue({
        id: OS, equipment: { modelo: 'Escavadeira' },
      }),
    },
  };
  return { prisma, tx, chamadas };
}

const itemDeTroca = {
  linhaId: 'l1',
  descricao: 'Filtro de óleo',
  codigoPeca: '32925682',
  pecaId: 'p-1',
  quantidade: 1,
  unidade: null,
  impeditivo: true,
};

describe('reservarParaOs', () => {
  it('trava a linha do saldo ANTES de decidir', async () => {
    const { prisma, chamadas } = prismaFalso(5, 0);
    const servico = new AlmoxarifadoService(prisma as never);

    await servico.reservarParaOs({
      companyId: COMPANY, serviceOrderId: OS, depositoId: DEPOSITO,
      autorCompanyUserId: AUTOR, categoriaPlanoId: 'cat-1', cicloId: 'c1',
    });

    // Ler o saldo, decidir e gravar em chamadas separadas é exatamente o bug
    // que a regra de concorrência descreve.
    expect(chamadas[0]).toBe('SELECT FOR UPDATE');
    expect(chamadas).toContain('UPDATE saldo');
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('com saldo, o item fica reservado e a OS vai para separação', async () => {
    const { prisma } = prismaFalso(5, 0);
    const servico = new AlmoxarifadoService(prisma as never);

    const r = await servico.reservarParaOs({
      companyId: COMPANY, serviceOrderId: OS, depositoId: DEPOSITO,
      autorCompanyUserId: AUTOR, categoriaPlanoId: 'cat-1', cicloId: 'c1',
    });

    expect(r.itens[0]).toMatchObject({ status: 'reservada', quantidadeReservada: 1 });
    expect(r.statusMateriais).toBe('aguardando_separacao');
  });

  it('sem saldo, o item fica faltante e a OS vai para aguardando compra', async () => {
    const { prisma } = prismaFalso(0, 0);
    const servico = new AlmoxarifadoService(prisma as never);

    const r = await servico.reservarParaOs({
      companyId: COMPANY, serviceOrderId: OS, depositoId: DEPOSITO,
      autorCompanyUserId: AUTOR, categoriaPlanoId: 'cat-1', cicloId: 'c1',
    });

    expect(r.itens[0]).toMatchObject({ status: 'faltante', quantidadeReservada: 0 });
    expect(r.statusMateriais).toBe('aguardando_compra');
  });

  it('saldo parcial reserva o que existe e marca a diferença como falta', async () => {
    // Critério de aceite 2: "reserva o disponível e solicita somente a diferença".
    const { prisma } = prismaFalso(3, 0);
    const servico = new AlmoxarifadoService(prisma as never);

    const r = await servico.reservarParaOs({
      companyId: COMPANY, serviceOrderId: OS, depositoId: DEPOSITO,
      autorCompanyUserId: AUTOR, categoriaPlanoId: 'cat-1', cicloId: 'c1',
    }, { itensDoPlano: [{ ...itemDeTroca, quantidade: 5 }] });

    expect(r.itens[0]).toMatchObject({
      status: 'faltante', quantidadeReservada: 3, quantidadeFaltante: 2,
    });
  });

  it('saldo comprometido com outra OS não conta como disponível', async () => {
    // Critério de aceite 1, o cerne: físico 5, reservado 5, disponível 0.
    const { prisma } = prismaFalso(5, 5);
    const servico = new AlmoxarifadoService(prisma as never);

    const r = await servico.reservarParaOs({
      companyId: COMPANY, serviceOrderId: OS, depositoId: DEPOSITO,
      autorCompanyUserId: AUTOR, categoriaPlanoId: 'cat-1', cicloId: 'c1',
    });

    expect(r.itens[0].status).toBe('faltante');
  });

  it('item sem peça resolvida não vira reserva nem some', async () => {
    // "Não vinculado" é estado de primeira classe: não pode virar verde nem
    // vermelho, e não pode desaparecer da lista.
    const { prisma } = prismaFalso(5, 0);
    const servico = new AlmoxarifadoService(prisma as never);

    const r = await servico.reservarParaOs({
      companyId: COMPANY, serviceOrderId: OS, depositoId: DEPOSITO,
      autorCompanyUserId: AUTOR, categoriaPlanoId: 'cat-1', cicloId: 'c1',
    }, { itensDoPlano: [{ ...itemDeTroca, pecaId: null, codigoPeca: null }] });

    expect(r.itens[0].status).toBe('nao_vinculado');
  });

  it('OS de outra empresa (ou inexistente) não gera requisição nem entra em transação', async () => {
    // Divergência achada em relação ao brief: o snippet original resolve
    // `os?.equipment?.modelo ?? 'Geral'` mesmo quando `findFirst` (já
    // filtrado por companyId) devolve null, e SEGUE — a requisição seria
    // criada e `tx.serviceOrder.update` escreveria numa OS que não é desta
    // empresa (ou não existe). O padrão do resto do módulo `mecanica`
    // (`mecanica.service.ts`, ex. `relatosDoOperador`) é `if (!os) throw new
    // NotFoundException(...)` logo após o `findFirst` — replicado aqui.
    const { prisma } = prismaFalso(5, 0);
    prisma.serviceOrder.findFirst.mockResolvedValue(null);
    const servico = new AlmoxarifadoService(prisma as never);

    await expect(
      servico.reservarParaOs({
        companyId: COMPANY, serviceOrderId: OS, depositoId: DEPOSITO,
        autorCompanyUserId: AUTOR, categoriaPlanoId: 'cat-1', cicloId: 'c1',
      }),
    ).rejects.toThrow(NotFoundException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});

describe('darEntrada', () => {
  /**
   * Mesmo molde de `prismaFalso`: o `tx` falso registra a ordem das chamadas
   * para provar que a trava (`SELECT FOR UPDATE`) acontece antes de somar e
   * gravar — duas entradas simultâneas da mesma peça não podem somar sobre o
   * mesmo saldo lido.
   */
  function prismaFalsoEntrada(saldoFisico: number) {
    const chamadas: string[] = [];
    const tx = {
      $queryRaw: jest.fn(async () => {
        chamadas.push('SELECT FOR UPDATE');
        return [{ saldo_fisico: saldoFisico }];
      }),
      peca: {
        findFirstOrThrow: jest.fn(async () => ({ custoMedio: 10 })),
        update: jest.fn(async () => {
          chamadas.push('UPDATE peca');
          return {};
        }),
      },
      pecaSaldo: {
        upsert: jest.fn(async () => {
          chamadas.push('UPSERT saldo');
          return {};
        }),
      },
      estoqueMovimento: {
        create: jest.fn(async () => {
          chamadas.push('INSERT movimento');
          return {};
        }),
      },
    };
    const prisma = {
      $transaction: jest.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
    };
    return { prisma, tx, chamadas };
  }

  it('trava a linha do saldo ANTES de somar a entrada', async () => {
    const { prisma, chamadas } = prismaFalsoEntrada(10);
    const servico = new AlmoxarifadoService(prisma as never);

    await servico.darEntrada({
      companyId: COMPANY, pecaId: PECA, depositoId: DEPOSITO,
      quantidade: 5, custoUnit: 20, autorCompanyUserId: AUTOR,
    });

    expect(chamadas[0]).toBe('SELECT FOR UPDATE');
    expect(chamadas).toContain('UPSERT saldo');
    expect(chamadas).toContain('INSERT movimento');
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('quantidade zero é rejeitada antes de abrir a transação', async () => {
    const { prisma } = prismaFalsoEntrada(10);
    const servico = new AlmoxarifadoService(prisma as never);

    await expect(
      servico.darEntrada({
        companyId: COMPANY, pecaId: PECA, depositoId: DEPOSITO,
        quantidade: 0, custoUnit: 20, autorCompanyUserId: AUTOR,
      }),
    ).rejects.toThrow(BadRequestException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('custoUnit nulo mantém o custo médio (devolução de sobra sem nota)', async () => {
    const { prisma, tx } = prismaFalsoEntrada(10);
    const servico = new AlmoxarifadoService(prisma as never);

    const r = await servico.darEntrada({
      companyId: COMPANY, pecaId: PECA, depositoId: DEPOSITO,
      quantidade: 5, custoUnit: null, autorCompanyUserId: AUTOR,
    });

    expect(r.custoMedio).toBe(10);
    expect(tx.estoqueMovimento.create.mock.calls[0][0].data.custoUnit).toBeNull();
  });
});
