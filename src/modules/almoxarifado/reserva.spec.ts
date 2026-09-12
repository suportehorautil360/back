import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { AlmoxarifadoService } from './almoxarifado.service';
import { Prisma } from '../../prisma/generated/client';

/** Fabrica o erro que o Postgres/Prisma devolve numa colisão de unique. */
function erroDeUniqueViolado(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError(
    'Unique constraint failed on the fields: (`company_id`,`numero`)',
    { code: 'P2002', clientVersion: '7.9.1', meta: { target: ['company_id', 'numero'] } },
  );
}

/**
 * Fabrica o erro que o Prisma devolve para uma raw query (`$queryRaw`/
 * `$executeRaw`) que falha no Postgres: `P2010` com o SQLSTATE cru em
 * `meta.code`. `40P01` é deadlock; `40001` é falha de serialização —
 * achado Important I1.
 */
function erroDeContencaoPg(sqlstate: '40P01' | '40001'): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError(
    `Raw query failed. Code: \`${sqlstate}\`. Message: \`contenção simulada\``,
    { code: 'P2010', clientVersion: '7.9.1', meta: { code: sqlstate, message: 'contenção simulada' } },
  );
}

const COMPANY = '11111111-1111-1111-1111-111111111111';
const DEPOSITO = '22222222-2222-2222-2222-222222222222';
const OS = '33333333-3333-3333-3333-333333333333';
const AUTOR = '44444444-4444-4444-4444-444444444444';
const PECA = '55555555-5555-5555-5555-555555555555';

/** Extrai o primeiro valor interpolado de uma chamada a `$queryRaw`/`$executeRaw`. */
function primeiroValor(chamada: unknown[]): unknown {
  return (chamada[0] as { values: unknown[] }).values[0];
}

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
      // Achado Important I3: nenhuma requisição aberta para a OS ainda —
      // clique repetido depois que a resposta já chegou é testado abaixo,
      // sobrescrevendo este mock para devolver uma requisição existente.
      findFirst: jest.fn().mockResolvedValue(null),
      // `findMany`, não `findFirst` + `orderBy: 'desc'`: o número precisa do
      // MAX numérico (achado C1), não do maior em ordem de texto.
      findMany: jest.fn().mockResolvedValue([]),
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
      // Achado Important I4: `updateMany` (não `update`) — `count` vem de
      // quantas linhas casaram com `{ id, companyId }`.
      updateMany: jest.fn(async () => {
        chamadas.push('UPDATE os');
        return { count: 1 };
      }),
    },
  };
  const prisma = {
    $transaction: jest.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
    // Achado Important I2: depósito existe, é desta empresa, está ativo.
    deposito: { findFirst: jest.fn().mockResolvedValue({ id: DEPOSITO }) },
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
      // Usado só no caminho de ciclo sem item nenhum (achado I6), que não
      // abre transação.
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
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
    const { prisma, chamadas, tx } = prismaFalso(5, 0);
    const servico = new AlmoxarifadoService(prisma as never);

    await servico.reservarParaOs({
      companyId: COMPANY, serviceOrderId: OS, depositoId: DEPOSITO,
      autorCompanyUserId: AUTOR, categoriaPlanoId: 'cat-1', cicloId: 'c1',
    });

    // Achado I8.1: afirma o SQL DE VERDADE, não um rótulo que qualquer
    // chamada a `$queryRaw` acionaria — apagar "FOR UPDATE" da query de
    // produção tem que fazer esta linha falhar.
    expect(tx.$queryRaw.mock.calls[0][0].text).toMatch(/FOR UPDATE/i);
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

  it('peça sem NENHUMA linha de saldo (nunca recebeu entrada) marca falta e não escreve', async () => {
    // Confirma o pedido da revisão (achado C2): a reserva NÃO tem o buraco
    // de `darEntrada` (que fazia UPSERT — logo, criava a linha em cima de
    // uma corrida). A reserva NUNCA cria `peca_saldos`; se a linha não
    // existe (`$queryRaw` devolve array vazio), `saldo` fica `null`,
    // `livre = 0`, `reservar = Math.min(0, quantidade) = 0`, e
    // `if (reservar > 0)` pula o `$executeRaw` inteiro. Duas OS concorrentes
    // pedindo a mesma peça nunca vista pelo almoxarifado recebem "falta" as
    // DUAS, e nenhuma delas escreve nada — resultado conservador, sem
    // escrita para colidir.
    const { prisma, tx } = prismaFalso(5, 0); // saldoFisico/saldoReservado ignorados pelo override abaixo
    tx.$queryRaw = jest.fn(async () => []);
    const servico = new AlmoxarifadoService(prisma as never);

    const r = await servico.reservarParaOs({
      companyId: COMPANY, serviceOrderId: OS, depositoId: DEPOSITO,
      autorCompanyUserId: AUTOR, categoriaPlanoId: 'cat-1', cicloId: 'c1',
    });

    expect(r.itens[0]).toMatchObject({ status: 'faltante', quantidadeReservada: 0 });
    expect(tx.$executeRaw).not.toHaveBeenCalled();
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

  it('depósito de outra empresa (ou inexistente) não chega a olhar plano nem abre transação (achado I2)', async () => {
    const { prisma } = prismaFalso(5, 0);
    prisma.deposito.findFirst.mockResolvedValue(null);
    const servico = new AlmoxarifadoService(prisma as never);

    await expect(
      servico.reservarParaOs({
        companyId: COMPANY, serviceOrderId: OS, depositoId: DEPOSITO,
        autorCompanyUserId: AUTOR, categoriaPlanoId: 'cat-1', cicloId: 'c1',
      }),
    ).rejects.toThrow(NotFoundException);
    expect(prisma.serviceOrder.findFirst).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('segunda chamada para a MESMA OS é rejeitada — clique repetido depois da resposta (achado I3)', async () => {
    const { prisma, tx } = prismaFalso(5, 0);
    tx.requisicaoMaterial.findFirst.mockResolvedValue({ id: 'req-existente' });
    const servico = new AlmoxarifadoService(prisma as never);

    await expect(
      servico.reservarParaOs({
        companyId: COMPANY, serviceOrderId: OS, depositoId: DEPOSITO,
        autorCompanyUserId: AUTOR, categoriaPlanoId: 'cat-1', cicloId: 'c1',
      }),
    ).rejects.toThrow(ConflictException);
    // Nem chegou a travar peca_saldos: a checagem de duplicata vem antes.
    expect(tx.$queryRaw).not.toHaveBeenCalled();
  });

  it('updateMany com companyId barra OS de outra empresa mesmo pulando itensDoPlanoDaOs via override (achado I4)', async () => {
    // `override` é o segundo parâmetro PÚBLICO de `reservarParaOs` — pula
    // `itensDoPlanoDaOs` (onde vive a checagem de posse da OS) inteira.
    // Sem a I4, nada mais impediria escrever na OS errada por este caminho.
    const { prisma, tx } = prismaFalso(5, 0);
    tx.serviceOrder.updateMany.mockResolvedValue({ count: 0 }); // OS não é desta empresa
    const servico = new AlmoxarifadoService(prisma as never);

    await expect(
      servico.reservarParaOs({
        companyId: COMPANY, serviceOrderId: OS, depositoId: DEPOSITO,
        autorCompanyUserId: AUTOR, categoriaPlanoId: 'cat-1', cicloId: 'c1',
      }, { itensDoPlano: [itemDeTroca] }),
    ).rejects.toThrow(NotFoundException);
  });

  it('ciclo sem NENHUM item de troca não cria requisição — retorna cedo (achado I6)', async () => {
    const { prisma } = prismaFalso(5, 0);
    const servico = new AlmoxarifadoService(prisma as never);

    const r = await servico.reservarParaOs({
      companyId: COMPANY, serviceOrderId: OS, depositoId: DEPOSITO,
      autorCompanyUserId: AUTOR, categoriaPlanoId: 'cat-1', cicloId: 'c1',
    }, { itensDoPlano: [] });

    expect(r).toEqual({
      requisicaoId: null, numero: null, statusMateriais: 'liberada_para_execucao', itens: [],
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.serviceOrder.updateMany).toHaveBeenCalledWith({
      where: { id: OS, companyId: COMPANY },
      data: { statusMateriais: 'liberada_para_execucao' },
    });
  });

  it('trava peca_saldos SEMPRE na mesma ordem por pecaId — evita deadlock entre duas reservas (achado I1)', async () => {
    const { prisma, tx } = prismaFalso(5, 0);
    const servico = new AlmoxarifadoService(prisma as never);
    // O PLANO pede p-2 antes de p-1 — a ordem oposta da ordenação por id.
    const itemA = { ...itemDeTroca, linhaId: 'lA', pecaId: 'p-2', codigoPeca: 'X2' };
    const itemB = { ...itemDeTroca, linhaId: 'lB', pecaId: 'p-1', codigoPeca: 'X1' };

    const r = await servico.reservarParaOs({
      companyId: COMPANY, serviceOrderId: OS, depositoId: DEPOSITO,
      autorCompanyUserId: AUTOR, categoriaPlanoId: 'cat-1', cicloId: 'c1',
    }, { itensDoPlano: [itemA, itemB] });

    // Ordem de TRAVA: por pecaId ('p-1' antes de 'p-2'), não a ordem do
    // plano — é isto que faz duas reservas concorrentes, pedindo as mesmas
    // peças em ordens opostas do plano, travarem na MESMA ordem em vez de
    // se travarem mutuamente (deadlock, 40P01).
    expect(tx.$queryRaw.mock.calls.map(primeiroValor)).toEqual(['p-1', 'p-2']);
    // Ordem da RESPOSTA: a do PLANO (é o que a tela mostra).
    expect(r.itens.map((i) => i.linhaId)).toEqual(['lA', 'lB']);
  });

  it('deadlock (40P01) entre duas reservas também aciona o retry da transação inteira (achado I1)', async () => {
    const { prisma, tx } = prismaFalso(5, 0);
    let tentativas = 0;
    tx.$queryRaw = jest.fn(async () => {
      tentativas++;
      if (tentativas === 1) throw erroDeContencaoPg('40P01');
      return [{ saldo_fisico: 5, saldo_reservado: 0 }];
    });
    const servico = new AlmoxarifadoService(prisma as never);

    const r = await servico.reservarParaOs({
      companyId: COMPANY, serviceOrderId: OS, depositoId: DEPOSITO,
      autorCompanyUserId: AUTOR, categoriaPlanoId: 'cat-1', cicloId: 'c1',
    });

    expect(tentativas).toBe(2);
    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
    expect(r.itens[0].status).toBe('reservada');
  });

  it('falha de serialização (40001) também aciona o retry', async () => {
    const { prisma, tx } = prismaFalso(5, 0);
    let tentativas = 0;
    tx.$queryRaw = jest.fn(async () => {
      tentativas++;
      if (tentativas === 1) throw erroDeContencaoPg('40001');
      return [{ saldo_fisico: 5, saldo_reservado: 0 }];
    });
    const servico = new AlmoxarifadoService(prisma as never);

    await servico.reservarParaOs({
      companyId: COMPANY, serviceOrderId: OS, depositoId: DEPOSITO,
      autorCompanyUserId: AUTOR, categoriaPlanoId: 'cat-1', cicloId: 'c1',
    });

    expect(tentativas).toBe(2);
    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
  });

  it('recalcula o número e tenta de novo quando duas reservas colidem no mesmo REQ-... (P2002)', async () => {
    // É o teste que separa "o unique absorve a concorrência" (errado — o
    // brief original dizia isso) de "o unique detecta, o retry absorve"
    // (correto): a mesma corrida de duas OS abertas no mesmo segundo que o
    // `SELECT FOR UPDATE` resolve para o SALDO também pode acontecer no
    // NÚMERO da requisição — e sem retry, a segunda perderia a reserva
    // inteira com um 500, mesmo tendo saldo de sobra para as duas.
    const { prisma, tx } = prismaFalso(5, 0);
    let tentativas = 0;
    tx.requisicaoMaterial.create = jest.fn(async () => {
      tentativas++;
      if (tentativas === 1) throw erroDeUniqueViolado();
      return { id: 'req-2', numero: 'REQ-2026-002' };
    });
    const servico = new AlmoxarifadoService(prisma as never);

    const r = await servico.reservarParaOs({
      companyId: COMPANY, serviceOrderId: OS, depositoId: DEPOSITO,
      autorCompanyUserId: AUTOR, categoriaPlanoId: 'cat-1', cicloId: 'c1',
    });

    expect(tentativas).toBe(2);
    // A transação inteira foi refeita — não só o INSERT — porque depois de
    // um erro o Postgres marca a transação como abortada.
    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
    // Achado I8.2: prova que o número foi RECALCULADO (não só que a
    // transação rodou de novo) e que o saldo foi RELIDO na segunda tentativa.
    expect(tx.requisicaoMaterial.findMany).toHaveBeenCalledTimes(2);
    expect(tx.$queryRaw).toHaveBeenCalledTimes(2);
    expect(r.numero).toBe('REQ-2026-002');
    expect(r.itens[0]).toMatchObject({ status: 'reservada', quantidadeReservada: 1 });
  });

  it('desiste depois do teto de tentativas e propaga um erro que explica o que houve', async () => {
    const { prisma, tx } = prismaFalso(5, 0);
    tx.requisicaoMaterial.create = jest.fn(async () => {
      throw erroDeUniqueViolado();
    });
    const servico = new AlmoxarifadoService(prisma as never);

    await expect(
      servico.reservarParaOs({
        companyId: COMPANY, serviceOrderId: OS, depositoId: DEPOSITO,
        autorCompanyUserId: AUTOR, categoriaPlanoId: 'cat-1', cicloId: 'c1',
      }),
    ).rejects.toThrow(ConflictException);
    // Não é um 500 mudo: o teto tem um número fixo de tentativas.
    expect(tx.requisicaoMaterial.create).toHaveBeenCalledTimes(5);
    expect(prisma.$transaction).toHaveBeenCalledTimes(5);
  });

  it('erro que NÃO é colisão de número nem contenção do Postgres propaga na hora, sem retry', async () => {
    const { prisma, tx } = prismaFalso(5, 0);
    const erroQualquer = new Error('conexão caiu');
    tx.requisicaoMaterial.create = jest.fn(async () => {
      throw erroQualquer;
    });
    const servico = new AlmoxarifadoService(prisma as never);

    await expect(
      servico.reservarParaOs({
        companyId: COMPANY, serviceOrderId: OS, depositoId: DEPOSITO,
        autorCompanyUserId: AUTOR, categoriaPlanoId: 'cat-1', cicloId: 'c1',
      }),
    ).rejects.toThrow(erroQualquer);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });
});

describe('darEntrada', () => {
  /**
   * Mesmo molde de `prismaFalso`: o `tx` falso registra a ordem das chamadas.
   * Prova o achado C2: `UPSERT` (garante a linha) tem que vir ANTES do
   * `SELECT … FOR UPDATE` (trava), que tem que vir antes da LEITURA — porque
   * `FOR UPDATE` não trava linha que ainda não existe, e travar uma linha que
   * não existe não protege nada.
   */
  function prismaFalsoEntrada(saldoFisico: number) {
    const chamadas: string[] = [];
    const tx = {
      $executeRaw: jest.fn(async () => {
        chamadas.push('SELECT FOR UPDATE');
        return 1;
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
          chamadas.push('UPSERT garante linha');
          return {};
        }),
        findUniqueOrThrow: jest.fn(async () => {
          chamadas.push('READ saldo travado');
          return { saldoFisico };
        }),
        update: jest.fn(async () => {
          chamadas.push('UPDATE saldo');
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
      // Achado Important I2: mesma checagem de posse do depósito da reserva.
      deposito: { findFirst: jest.fn().mockResolvedValue({ id: DEPOSITO }) },
      $transaction: jest.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
    };
    return { prisma, tx, chamadas };
  }

  it('garante a linha (UPSERT) ANTES de travar — FOR UPDATE não trava linha inexistente', async () => {
    const { prisma, chamadas, tx } = prismaFalsoEntrada(10);
    const servico = new AlmoxarifadoService(prisma as never);

    await servico.darEntrada({
      companyId: COMPANY, pecaId: PECA, depositoId: DEPOSITO,
      quantidade: 5, custoUnit: 20, autorCompanyUserId: AUTOR,
    });

    // Achado I8.1: afirma o SQL de verdade, não só o rótulo.
    expect(tx.$executeRaw.mock.calls[0][0].text).toMatch(/FOR UPDATE/i);
    expect(chamadas.indexOf('UPSERT garante linha')).toBeLessThan(chamadas.indexOf('SELECT FOR UPDATE'));
    expect(chamadas.indexOf('SELECT FOR UPDATE')).toBeLessThan(chamadas.indexOf('READ saldo travado'));
    expect(chamadas.indexOf('READ saldo travado')).toBeLessThan(chamadas.indexOf('UPDATE saldo'));
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('duas entradas na MESMA peça/depósito somam — não sobrescrevem (achado C2)', async () => {
    // Simula a serialização que `FOR UPDATE` garante em produção: a segunda
    // transação só lê depois que a primeira terminou. Um `tx` só, com um
    // "banco" compartilhado por trás de `pecaSaldo` — se o código somasse
    // errado (lesse sempre 0, ou sobrescrevesse com valor absoluto sem somar
    // o que já estava lá), a segunda chamada não chegaria em 8.
    let saldoNoBanco: number | undefined; // undefined = linha não existe ainda
    const tx = {
      $executeRaw: jest.fn(async () => 1),
      peca: {
        findFirstOrThrow: jest.fn(async () => ({ custoMedio: 10 })),
        update: jest.fn(async () => ({})),
      },
      pecaSaldo: {
        upsert: jest.fn(async () => {
          if (saldoNoBanco === undefined) saldoNoBanco = 0; // create, saldo default 0
          return {}; // já existia: update: {} não muda nada
        }),
        findUniqueOrThrow: jest.fn(async () => ({ saldoFisico: saldoNoBanco })),
        update: jest.fn(async ({ data }: { data: { saldoFisico: number } }) => {
          saldoNoBanco = data.saldoFisico;
          return {};
        }),
      },
      estoqueMovimento: { create: jest.fn(async () => ({})) },
    };
    const prisma = {
      deposito: { findFirst: jest.fn().mockResolvedValue({ id: DEPOSITO }) },
      $transaction: jest.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
    };
    const servico = new AlmoxarifadoService(prisma as never);

    const primeira = await servico.darEntrada({
      companyId: COMPANY, pecaId: PECA, depositoId: DEPOSITO,
      quantidade: 5, custoUnit: 20, autorCompanyUserId: AUTOR,
    });
    expect(primeira.saldoFisico).toBe(5); // 0 (linha nova) + 5

    const segunda = await servico.darEntrada({
      companyId: COMPANY, pecaId: PECA, depositoId: DEPOSITO,
      quantidade: 3, custoUnit: 20, autorCompanyUserId: AUTOR,
    });
    expect(segunda.saldoFisico).toBe(8); // 5 (o que a primeira deixou) + 3, NUNCA 3
  });

  it('depósito de outra empresa (ou inexistente) não abre transação (achado I2)', async () => {
    const { prisma } = prismaFalsoEntrada(10);
    prisma.deposito.findFirst.mockResolvedValue(null);
    const servico = new AlmoxarifadoService(prisma as never);

    await expect(
      servico.darEntrada({
        companyId: COMPANY, pecaId: PECA, depositoId: DEPOSITO,
        quantidade: 5, custoUnit: 20, autorCompanyUserId: AUTOR,
      }),
    ).rejects.toThrow(NotFoundException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
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

  it('novoCustoMedio recebe o saldo ANTERIOR, não o saldo depois de somar a entrada (achado I8.3)', async () => {
    // O único teste de custo que já existia usava `custoUnit: null` — nesse
    // caminho a média não muda, e trocar `anterior` por `depois` no serviço
    // não quebraria aquele teste. Este usa números que DISTINGUEM as duas
    // contas de propósito.
    const { prisma, tx } = prismaFalsoEntrada(10); // saldoFisico ANTERIOR = 10
    tx.peca.findFirstOrThrow = jest.fn(async () => ({ custoMedio: 8 }));
    const servico = new AlmoxarifadoService(prisma as never);

    const r = await servico.darEntrada({
      companyId: COMPANY, pecaId: PECA, depositoId: DEPOSITO,
      quantidade: 5, custoUnit: 20, autorCompanyUserId: AUTOR,
    });

    // Com ANTERIOR = 10: (10*8 + 5*20) / 15 = 12.
    // Se o serviço passasse DEPOIS = 15 por engano: (15*8 + 5*20) / 20 = 11.
    // Os dois números são diferentes de propósito — qualquer troca entre as
    // duas contas quebra esta asserção.
    expect(r.custoMedio).toBe(12);
    expect(tx.peca.update.mock.calls[0][0].data.custoMedio).toBe(12);
  });
});
