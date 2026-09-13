import { BadRequestException, ConflictException } from '@nestjs/common';
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
function montar(
  status: string,
  itens: Array<Record<string, unknown>>,
  opts: { semSaldo?: boolean; comDestinatariosDeNotificacao?: boolean } = {},
) {
  const chamadas: string[] = [];
  const itensDb = new Map(itens.map((i) => [i.id as string, { ...i }]));
  // Estado fake da COLUNA `requisicaoMaterial.liberadaEm` — só existe para o
  // guard `where: { liberadaEm: null }` de `liberarRequisicao` (achado
  // Important I3 da rodada 2) ter algo real para checar entre chamadas
  // sucessivas dentro do MESMO teste (ver "dois POSTs sequenciais" abaixo).
  let liberadaEmAtual: Date | null = null;

  const tx = {
    // Achado I3 da revisão: registra QUAL peça foi travada (`values[0]` é o
    // primeiro `${...}` do `Prisma.sql`, sempre `item.pecaId` nas duas raw
    // queries deste arquivo) — não só que uma trava aconteceu. Sem isto, um
    // refactor que tirasse `FOR UPDATE` do laço continuaria verde no teste
    // de ordenação (que olharia só a ordem dos `UPDATE` de item).
    $queryRaw: jest.fn(async (query: { values: unknown[] }) => {
      chamadas.push(`LOCK ${query.values[0]}`);
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
        // Task 8: `liberarRequisicao` lê `req.deposito.nome`/`req.serviceOrder.*`
        // para `notificarOsLiberada` — sem isto o teste quebra com "Cannot
        // read properties of undefined", não com uma asserção de negócio.
        // Por padrão `equipmentId`/`responsavelOperatorId` nulos mantêm a
        // notificação sem destinatário (mesmo branch coberto em
        // `almoxarifado-notificacoes.spec.ts`); os 19 testes que já
        // passavam não pedem `comDestinatariosDeNotificacao` e continuam
        // roteando por aqui, sem tocar `tx.company`/`tx.operator`/
        // `tx.notificacao`.
        deposito: { nome: 'Almoxarifado Central' },
        serviceOrder: {
          protocolo: 'OS-2026-047',
          equipmentId: opts.comDestinatariosDeNotificacao ? 'eq-1' : null,
          equipmentNome: opts.comDestinatariosDeNotificacao ? 'ESC-014' : null,
          responsavelOperatorId: opts.comDestinatariosDeNotificacao ? 'op-mec' : null,
        },
      }),
      update: jest.fn(async () => { chamadas.push('UPDATE requisicao'); return {}; }),
      // Achado Important I1 da revisão: o fechamento da ENTREGA usa
      // `updateMany` condicionado a `status: 'separada'` — `count: 0`
      // simula uma segunda chamada chegando depois que a primeira já
      // fechou. Achado Important I3 da rodada 2: `liberarRequisicao` PASSOU
      // a usar `updateMany` também, condicionado a `liberadaEm: null` (a
      // notificação só sai na liberação que de fato é a primeira) — o MESMO
      // mock atende as duas formas de `where`, discriminando por qual
      // campo aparece nele.
      updateMany: jest.fn(async ({ where }: { where: Record<string, unknown> }) => {
        chamadas.push('UPDATE requisicao');
        if ('liberadaEm' in where) {
          if (where.liberadaEm !== null || liberadaEmAtual !== null) return { count: 0 };
          liberadaEmAtual = new Date();
          return { count: 1 };
        }
        return { count: 1 };
      }),
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
      // A releitura FRESCA que `liberarRequisicao` e `entregarRequisicao`
      // fazem para decidir `statusMateriais` — mesma razão de
      // `findUniqueOrThrow` acima: sem isto, o serviço teria de decidir com
      // `req.itens` (o retrato de fora da transação), o mesmo defeito pela
      // quinta (liberação) e sexta (entrega) vez nesta frente.
      findMany: jest.fn(async () => [...itensDb.values()].map((i) => ({ ...i }))),
    },
    estoqueMovimento: {
      // Achado Important N2 da 3ª revisão: o rótulo precisa do `pecaId` —
      // sem ele, uma asserção como `chamadas.some(c => c.includes('p-3'))`
      // é `false` por construção (a string nunca teve `p-3` para achar), e
      // "passa" mesmo que o razão receba um movimento para aquela peça.
      create: jest.fn(async (a: { data: { quantidade: number; tipo: string; pecaId: string } }) => {
        chamadas.push(`MOVIMENTO ${a.data.tipo} ${a.data.quantidade} ${a.data.pecaId}`);
        return {};
      }),
    },
    serviceOrderInsumo: {
      create: jest.fn(async () => { chamadas.push('INSUMO'); return {}; }),
      // Achado m3 da revisão: `entregarRequisicao` continua a numeração dos
      // insumos que a OS já tem (mesmo critério do orçamento aprovado) — por
      // padrão simula uma OS sem nenhum insumo ainda.
      count: jest.fn(async () => 0),
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
    // Achado Important da rodada 1 de correção: os 19 testes de `liberarRequisicao`
    // que já existiam só exercitavam o ramo "sem destinatário" de
    // `notificarOsLiberada` — trocar a chamada por `Promise.resolve()` no
    // serviço continuava 190/190 verde. Estes delegates, resolvidos com um
    // destinatário quando `opts.comDestinatariosDeNotificacao`, fecham essa
    // lacuna (ver os testes "(integração)" abaixo).
    operator: {
      findFirst: jest.fn().mockResolvedValue(
        opts.comDestinatariosDeNotificacao ? { companyUserId: 'user-mec' } : null,
      ),
    },
    // Achado minor m3 da revisão: `findMany`, não `findFirst` — um
    // equipamento pode ter mais de um programador cadastrado.
    equipmentProgramador: {
      findMany: jest.fn().mockResolvedValue(
        opts.comDestinatariosDeNotificacao ? [{ companyUserId: 'user-prog' }] : [],
      ),
    },
    company: {
      findUnique: jest.fn().mockResolvedValue({ legacyId: 'leg-1' }),
    },
    notificacao: {
      createMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
  };
  const prisma = {
    $transaction: jest.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
    // A leitura da requisição (para validar o estado antes de abrir a
    // transação) usa `this.prisma`, não `tx` — igual a um `PrismaService` de
    // verdade, em que o mesmo delegate de modelo atende fora e dentro de
    // `$transaction`.
    requisicaoMaterial: tx.requisicaoMaterial,
    // Achado Important I4 da rodada 2: `enviarNotificacoes` grava com
    // `this.prisma` DEPOIS do commit — nunca com `tx`. Reaproveita a MESMA
    // instância do mock (`tx.notificacao`) para que os testes possam
    // continuar inspecionando `tx.notificacao.createMany`.
    notificacao: tx.notificacao,
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
    // Achado Important I3 da rodada 2: `liberarRequisicao` passou de
    // `.update` incondicional para `.updateMany` condicionado a
    // `liberadaEm: null`.
    const chamada = tx.requisicaoMaterial.updateMany.mock.calls[0][0] as {
      where: { id: string; liberadaEm: null };
      data: { liberadaEm: Date; liberadaPorCompanyUserId: string };
    };
    expect(chamada.where).toEqual({ id: REQ, liberadaEm: null });
    expect(chamada.data.liberadaEm).toBeInstanceOf(Date);
    expect(chamada.data.liberadaPorCompanyUserId).toBe(AUTOR);
    // Nenhuma chamada de saldo — liberar é ato administrativo, não físico.
    expect(chamadas.some((c) => c.startsWith('LOCK'))).toBe(false);
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

  it('recalcula statusMateriais a partir dos itens RELIDOS na transação, não do retrato de fora dela', async () => {
    // Quinta ocorrência do mesmo defeito nesta frente: simula uma
    // reconferência concorrente (`separarItens` aceita chamadas mesmo com
    // `status: 'separada'`) que mudou o item de `separada` para `faltante`
    // ENQUANTO a liberação estava em voo. O retrato de fora (`itens`, o que
    // `requisicaoMaterial.findFirst` devolveu) ainda mostra `separada`; o
    // "banco" (`itensDb`, relido por `findMany` dentro da transação) já
    // reflete a mudança. Os dois valores DIVERGEM de propósito — é essa
    // divergência que prova que o teste discrimina entre ler de fora e ler
    // de dentro.
    const { servico, itensDb } = montar('separada', [separado()]);
    itensDb.set('it-1', { ...separado(), status: 'faltante' });

    const r = await servico.liberarRequisicao({
      companyId: COMPANY, requisicaoId: REQ, autorCompanyUserId: AUTOR,
    });

    // Lendo de FORA (o retrato antigo, `separada`): `statusAposEntrega`
    // devolveria `liberada_para_execucao`. Lendo de DENTRO (o item fresco,
    // `faltante`): devolve `aguardando_compra`. O valor correto é o segundo.
    expect(r.statusMateriais).toBe('aguardando_compra');
  });

  it('avisa mecânico e programador quando a OS libera com destinatário (integração — achado Important da rodada 1)', async () => {
    // Os 4 testes acima provam o RESTO de `liberarRequisicao`, mas nenhum
    // passa pelo ramo COM destinatário de `notificarOsLiberada` — é
    // exatamente essa lacuna que permitiu trocar a chamada por
    // `Promise.resolve()` no serviço sem nenhum teste reclamar (ver
    // relatório da rodada 1). Este teste fecha o ramo cheio: mecânico e
    // programador são pessoas DIFERENTES ('user-mec'/'user-prog'), então a
    // notificação grava DUAS linhas.
    const { servico, tx } = montar('separada', [separado()], {
      comDestinatariosDeNotificacao: true,
    });
    await servico.liberarRequisicao({
      companyId: COMPANY, requisicaoId: REQ, autorCompanyUserId: AUTOR,
    });

    expect(tx.notificacao.createMany).toHaveBeenCalledTimes(1);
    const linhas = tx.notificacao.createMany.mock.calls[0][0].data as Array<{
      destinatarioId: string; referenciaTipo: string; referenciaId: string; mensagem: string;
    }>;
    expect(linhas.map((l) => l.destinatarioId).sort()).toEqual(['user-mec', 'user-prog']);
    for (const linha of linhas as Array<{
      destinatarioId: string; referenciaTipo: string; referenciaId: string; mensagem: string;
      destinatarioTipo: string; prefeituraLegacyId: string;
    }>) {
      expect(linha.referenciaTipo).toBe('service_order');
      expect(linha.referenciaId).toBe('os-1');
      // O nome do DEPÓSITO — sem ele o mecânico sabe que pode buscar mas
      // não sabe onde.
      expect(linha.mensagem).toContain('Almoxarifado Central');
      // Achado minor m5 da revisão: os campos que decidem se a notificação
      // é VISÍVEL não eram assertados por nada — o `tsc` só garante a
      // PRESENÇA (NOT NULL sem default), nunca o VALOR.
      expect(linha.destinatarioTipo).toBe('company_user');
      expect(linha.prefeituraLegacyId).toBe('leg-1');
    }
  });

  it('dois POSTs sequenciais que liberam a MESMA requisição geram UMA notificação só (achado Important I3)', async () => {
    // Não é concorrência — é o mesmo POST repetido (duplo clique, front que
    // reenvia). `req.status` continua `'separada'` depois de liberar (a
    // liberação não muda o status), então o guard de fora
    // (`req.status !== 'separada'`) sozinho NÃO barra a segunda chamada —
    // só o guard `liberadaEm: null`, condicionado dentro da transação, barra.
    const { servico, tx } = montar('separada', [separado()], {
      comDestinatariosDeNotificacao: true,
    });
    const chamar = () => servico.liberarRequisicao({
      companyId: COMPANY, requisicaoId: REQ, autorCompanyUserId: AUTOR,
    });

    const r1 = await chamar();
    const r2 = await chamar();

    expect(r1.statusMateriais).toBe('liberada_para_execucao');
    expect(r2.statusMateriais).toBe('liberada_para_execucao'); // resposta não muda de forma nem de conteúdo
    expect(tx.notificacao.createMany).toHaveBeenCalledTimes(1);
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
    expect(chamadas).toContain('MOVIMENTO saida -4 p-1');
  });

  it('trava antes de mexer no saldo', async () => {
    const { servico, chamadas } = montar('separada', [separado()]);
    await servico.entregarRequisicao({
      companyId: COMPANY, requisicaoId: REQ, autorCompanyUserId: AUTOR,
      recebedorOperatorId: MECANICO, confirmacaoTipo: 'pin',
    });
    expect(chamadas[0]).toMatch(/^LOCK /);
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

  it('grava saldoApos como o saldo físico DEPOIS do decremento, não o lido antes dele', async () => {
    // Achado I2 da revisão: sem esta asserção, nada provava que `saldoApos`
    // é o valor PÓS-decremento — comparar com a leitura crua do lock
    // (`linhas[0].saldo_fisico`, ainda '10') passaria mesmo se o código
    // esquecesse de subtrair. Com a fixture atual (saldo_fisico: '10',
    // separado: 4) o valor certo é 6.
    const { servico, tx } = montar('separada', [separado()]);
    await servico.entregarRequisicao({
      companyId: COMPANY, requisicaoId: REQ, autorCompanyUserId: AUTOR,
      recebedorOperatorId: MECANICO, confirmacaoTipo: 'pin',
    });
    const movimento = tx.estoqueMovimento.create.mock.calls[0][0].data;
    expect(Number(movimento.saldoApos)).toBe(6);
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
    //
    // `quantidadeReservada` continua 4 nos dois retratos NESTE teste, não
    // porque seja imutável — neste cenário (`separado: 4 > 0`) a entrega
    // nem chega a zerar `quantidadeReservada` (só grava `quantidadeEntregue`/
    // `status`); é só que este teste não simula mudança nela, só em
    // `quantidadeSeparada` — por isso a asserção olha as POSIÇÕES 0 e 2 do
    // `UPDATE` (saldo_fisico/saldo_separado, que usam a quantidade separada
    // FRESCA), não a posição 1 (saldo_reservado, que usa a reservada — 4 em
    // ambos os retratos, de propósito).
    const { servico, tx, itensDb, chamadas } = montar('separada', [separado()]);
    itensDb.set('it-1', { ...separado(), quantidadeSeparada: 2 });

    await servico.entregarRequisicao({
      companyId: COMPANY, requisicaoId: REQ, autorCompanyUserId: AUTOR,
      recebedorOperatorId: MECANICO, confirmacaoTipo: 'pin',
    });

    expect(chamadas).toContain('MOVIMENTO saida -2 p-1');
    const atualiza = tx.$executeRaw.mock.calls[0][0] as { values: unknown[] };
    expect(atualiza.values[0]).toBe(2); // saldo_fisico -= 2 (fresco)
    expect(atualiza.values[2]).toBe(2); // saldo_separado -= 2 (fresco)
    const insumo = tx.serviceOrderInsumo.create.mock.calls[0][0].data;
    expect(Number(insumo.quantidade)).toBe(2);
    expect(Number(itensDb.get('it-1')?.quantidadeEntregue)).toBe(2);
  });

  it('trava peca_saldos em ordem por pecaId, não pela ordem dos itens da requisição', async () => {
    const { servico, tx, chamadas } = montar('separada', [
      { ...separado(), id: 'it-2', pecaId: 'p-2' },
      { ...separado(), id: 'it-1', pecaId: 'p-1' },
    ]);
    await servico.entregarRequisicao({
      companyId: COMPANY, requisicaoId: REQ, autorCompanyUserId: AUTOR,
      recebedorOperatorId: MECANICO, confirmacaoTipo: 'pin',
    });
    // Achado I3 da revisão: olhar só a ordem dos `UPDATE` de item não pegaria
    // um refactor que tirasse a trava do laço (continuaria compilando e
    // passando, só sem `FOR UPDATE` nenhum) — por isso checa a ordem das
    // PRÓPRIAS travas, não só a consequência delas.
    const ordemDeTravas = chamadas
      .filter((c) => c.startsWith('LOCK'))
      .map((c) => c.replace('LOCK ', ''));
    expect(ordemDeTravas).toEqual(['p-1', 'p-2']);

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
    // `ConflictException`): é estado inconsistente com a reserva, não uma
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

  it('grava status entregue e os dados de recebimento na requisição, condicionado a ainda estar separada', async () => {
    const { servico, tx } = montar('separada', [separado()]);
    await servico.entregarRequisicao({
      companyId: COMPANY, requisicaoId: REQ, autorCompanyUserId: AUTOR,
      recebedorOperatorId: MECANICO, confirmacaoTipo: 'pin', assinatura: 'traço',
    });
    const chamada = tx.requisicaoMaterial.updateMany.mock.calls[0][0] as {
      where: { id: string; status: string };
      data: {
        status: string; entregueEm: Date; entreguePorCompanyUserId: string;
        recebedorOperatorId: string; confirmacaoTipo: string; assinatura: string | null;
      };
    };
    // Achado Important I1: condicionado ao status ainda ser `separada` —
    // sem isto, uma segunda chamada concorrente sobrescreveria estes dados.
    expect(chamada.where).toEqual({ id: REQ, status: 'separada' });
    expect(chamada.data.status).toBe('entregue');
    expect(chamada.data.entregueEm).toBeInstanceOf(Date);
    expect(chamada.data.entreguePorCompanyUserId).toBe(AUTOR);
    expect(chamada.data.recebedorOperatorId).toBe(MECANICO);
    expect(chamada.data.confirmacaoTipo).toBe('pin');
    expect(chamada.data.assinatura).toBe('traço');
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
    //
    // Achado Critical N1 da 3ª revisão: a fixture aqui tinha
    // `quantidadeReservada: 0`, justificada por um comentário que dizia "um
    // faltante genuíno (nada disponível na reserva) não entra em
    // `candidatos`" — PREMISSA FALSA. `faltante` neste módulo significa
    // "falta ALGUMA coisa", não "não tem nada": `executarReserva` estampa
    // `status: 'faltante'` COM `quantidadeReservada > 0` sempre que sobra
    // menos do que o solicitado (ex.: 3 reservados de 5 solicitados, sem
    // concorrência nenhuma — é o caso real, não um exagero de teste). Com
    // reservada zerada, o item ficava de fora de `candidatos` e o teste
    // "passava" sem nunca exercitar o caminho que o item realmente percorre
    // — foi essa fixture desarmada que deixou o N1 entrar despercebido.
    const { servico } = montar('separada', [
      separado(),
      {
        ...separado(), id: 'it-2', pecaId: 'p-2', status: 'faltante',
        quantidadeSolicitada: 5, quantidadeReservada: 3, quantidadeSeparada: 0,
      },
    ]);
    const r = await servico.entregarRequisicao({
      companyId: COMPANY, requisicaoId: REQ, autorCompanyUserId: AUTOR,
      recebedorOperatorId: MECANICO, confirmacaoTipo: 'pin',
    });
    expect(r.statusMateriais).toBe('aguardando_compra');
  });

  it('N1: item faltante PARCIAL devolve a reserva e some do saldo, mas NUNCA vira cancelada', async () => {
    // Mesmo cenário do teste acima, com as asserções que o brief da 3ª
    // revisão exigiu: o item continua `faltante` (não `cancelada`, que
    // apagaria a peça faltante do radar da compra), sua
    // `quantidadeReservada` zera (a reserva já voltou ao saldo — deixar "3
    // reservado" gravado seria mentir sobre o saldo), o `saldo_reservado` do
    // depósito cai pelas 3 unidades devolvidas, e `saldo_fisico` NÃO muda
    // para esta peça — nada saiu fisicamente do depósito.
    const faltanteParcial = {
      id: 'it-2', pecaId: 'p-2', quantidadeSolicitada: 5, quantidadeReservada: 3,
      quantidadeSeparada: 0, quantidadeEntregue: 0, status: 'faltante',
      impeditivo: false, divergencia: null, descricao: 'Correia', codigoPeca: '00000002',
    };
    const { servico, tx, itensDb } = montar('separada', [separado(), faltanteParcial]);
    const r = await servico.entregarRequisicao({
      companyId: COMPANY, requisicaoId: REQ, autorCompanyUserId: AUTOR,
      recebedorOperatorId: MECANICO, confirmacaoTipo: 'pin',
    });

    expect(r.statusMateriais).toBe('aguardando_compra');

    const itemAtualizado = tx.requisicaoMaterialItem.update.mock.calls.find(
      (c: [{ where: { id: string } }]) => c[0].where.id === 'it-2',
    )?.[0].data;
    // Só `quantidadeReservada` é gravada — `status` NÃO está no `data`, ou
    // seja, o `faltante` original sobrevive intacto no "banco".
    expect(itemAtualizado).toEqual({ quantidadeReservada: 0 });
    expect(itensDb.get('it-2')?.status).toBe('faltante');

    const updateDoFaltante = (tx.$executeRaw.mock.calls as [{ values: unknown[] }][]).find(
      (c) => c[0].values[3] === 'p-2',
    )?.[0].values;
    expect(updateDoFaltante).toBeDefined();
    expect(updateDoFaltante![0]).toBe(0); // saldo_fisico -= 0 (nada saiu)
    expect(updateDoFaltante![1]).toBe(3); // saldo_reservado -= 3 (devolve tudo)
    expect(updateDoFaltante![2]).toBe(0); // saldo_separado -= 0
  });

  // --- Critical C2 (segunda rodada de revisão) -----------------------------

  it('C2: item não impeditivo conferido em PARTE é entregue pelo que está na caixa, e a sobra da reserva é devolvida', async () => {
    // Reproduz o caminho do Critical C2 tal como o revisor o descreveu: item
    // NÃO impeditivo conferido em parte (2 de 4) fica em `reservada`
    // (`statusDoItemAposSeparacao`: meio item não libera meia OS), mas as 2
    // unidades JÁ foram fisicamente separadas — estão na caixa. Sem a
    // correção, o filtro de candidatos (`status === 'separada'`) deixava
    // este item de fora da entrega inteira: a requisição fechava como
    // `entregue` (terminal) com 4 de `saldo_reservado` e 2 de
    // `saldo_separado` presos para sempre, sem UPDATE nenhum.
    const parcial = {
      id: 'it-2', pecaId: 'p-2', quantidadeReservada: 4, quantidadeSeparada: 2,
      quantidadeEntregue: 0, status: 'reservada', impeditivo: false, divergencia: null,
      descricao: 'Correia', codigoPeca: '00000002',
    };
    const { servico, tx, chamadas } = montar('separada', [separado(), parcial]);
    await servico.entregarRequisicao({
      companyId: COMPANY, requisicaoId: REQ, autorCompanyUserId: AUTOR,
      recebedorOperatorId: MECANICO, confirmacaoTipo: 'pin',
    });

    const updateDoParcial = (tx.$executeRaw.mock.calls as [{ values: unknown[] }][]).find(
      (c) => c[0].values[3] === 'p-2',
    )?.[0].values;
    expect(updateDoParcial).toBeDefined();
    // saldo_fisico e saldo_separado descem só pelo que foi SEPARADO (2); o
    // saldo_reservado desce pelo total RESERVADO (4) — a diferença (2) é a
    // sobra que ficaria presa para sempre sem a correção.
    expect(updateDoParcial![0]).toBe(2); // saldo_fisico -= 2
    expect(updateDoParcial![1]).toBe(4); // saldo_reservado -= 4
    expect(updateDoParcial![2]).toBe(2); // saldo_separado -= 2

    expect(chamadas).toContain('MOVIMENTO saida -2 p-2');
    const itemAtualizado = tx.requisicaoMaterialItem.update.mock.calls.find(
      (c: [{ where: { id: string } }]) => c[0].where.id === 'it-2',
    )?.[0].data;
    expect(itemAtualizado).toEqual({ quantidadeEntregue: 2, status: 'entregue' });
  });

  it('C2: item não impeditivo nunca separado é cancelado e devolve a reserva inteira, sem movimento nem insumo', async () => {
    const nuncaSeparado = {
      id: 'it-3', pecaId: 'p-3', quantidadeReservada: 3, quantidadeSeparada: 0,
      quantidadeEntregue: 0, status: 'reservada', impeditivo: false, divergencia: null,
      descricao: 'Correia B', codigoPeca: '00000003',
    };
    const { servico, tx, chamadas } = montar('separada', [separado(), nuncaSeparado]);
    await servico.entregarRequisicao({
      companyId: COMPANY, requisicaoId: REQ, autorCompanyUserId: AUTOR,
      recebedorOperatorId: MECANICO, confirmacaoTipo: 'pin',
    });

    const updateDoItem = (tx.$executeRaw.mock.calls as [{ values: unknown[] }][]).find(
      (c) => c[0].values[3] === 'p-3',
    )?.[0].values;
    expect(updateDoItem).toBeDefined();
    expect(updateDoItem![0]).toBe(0); // saldo_fisico -= 0 (nada saiu fisicamente)
    expect(updateDoItem![1]).toBe(3); // saldo_reservado -= 3 (devolve tudo)
    expect(updateDoItem![2]).toBe(0); // saldo_separado -= 0

    // Nenhum movimento nem insumo para este item — nada saiu do depósito.
    expect(chamadas.some((c) => c.startsWith('MOVIMENTO') && c.includes('p-3'))).toBe(false);
    expect(tx.serviceOrderInsumo.create.mock.calls.length).toBe(1); // só o de 'it-1'

    const itemAtualizado = tx.requisicaoMaterialItem.update.mock.calls.find(
      (c: [{ where: { id: string } }]) => c[0].where.id === 'it-3',
    )?.[0].data;
    // `quantidadeReservada` zera junto (achado N1 da 3ª revisão): o UPDATE de
    // saldo já devolveu a reserva — o registro do item não pode continuar
    // dizendo "3 reservado".
    expect(itemAtualizado).toEqual({ status: 'cancelada', quantidadeReservada: 0 });
  });

  it('Important I1: segunda entrega concorrente não sobrescreve os dados de quem recebeu de verdade', async () => {
    // Simula a corrida: outra chamada já fechou a requisição (`count: 0`)
    // entre a checagem de fora da transação e o `updateMany` condicional.
    // Sem a condição no `where`, esta chamada gravaria os SEUS dados de
    // recebimento por cima dos da chamada vencedora, e devolveria 200.
    const { servico, tx } = montar('separada', [separado()]);
    tx.requisicaoMaterial.updateMany = jest.fn(async () => ({ count: 0 }));
    await expect(servico.entregarRequisicao({
      companyId: COMPANY, requisicaoId: REQ, autorCompanyUserId: AUTOR,
      recebedorOperatorId: MECANICO, confirmacaoTipo: 'pin',
    })).rejects.toBeInstanceOf(ConflictException);
  });

  // --- Important m2 e m3 (segunda rodada de revisão) -----------------------

  it('m2: confirmacaoTipo "assinatura" sem traço nenhum é recusado', async () => {
    const { servico } = montar('separada', [separado()]);
    await expect(servico.entregarRequisicao({
      companyId: COMPANY, requisicaoId: REQ, autorCompanyUserId: AUTOR,
      recebedorOperatorId: MECANICO, confirmacaoTipo: 'assinatura', assinatura: null,
    })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('m2: confirmacaoTipo "assinatura" com traço de verdade é aceito', async () => {
    const { servico } = montar('separada', [separado()]);
    const r = await servico.entregarRequisicao({
      companyId: COMPANY, requisicaoId: REQ, autorCompanyUserId: AUTOR,
      recebedorOperatorId: MECANICO, confirmacaoTipo: 'assinatura', assinatura: 'traço real',
    });
    expect(r.statusMateriais).toBe('liberada_para_execucao');
  });

  it('m3: numera os insumos na sequência da entrega, continuando o que a OS já tem', async () => {
    const segundo = {
      id: 'it-2', pecaId: 'p-2', quantidadeReservada: 3, quantidadeSeparada: 3,
      quantidadeEntregue: 0, status: 'separada', impeditivo: true, divergencia: null,
      descricao: 'Correia', codigoPeca: '00000002',
    };
    const { servico, tx } = montar('separada', [separado(), segundo]);
    tx.serviceOrderInsumo.count = jest.fn(async () => 2); // a OS já tinha 2 insumos lançados
    await servico.entregarRequisicao({
      companyId: COMPANY, requisicaoId: REQ, autorCompanyUserId: AUTOR,
      recebedorOperatorId: MECANICO, confirmacaoTipo: 'pin',
    });
    const ordens = tx.serviceOrderInsumo.create.mock.calls.map(
      (c: [{ data: { ordem: number } }]) => c[0].data.ordem,
    );
    expect(ordens).toEqual([2, 3]); // continua de onde a OS já estava
  });
});
