import { ConflictException } from '@nestjs/common';
import { AlmoxarifadoService } from './almoxarifado.service';
import { Prisma } from '../../prisma/generated/client';

const COMPANY = '11111111-1111-1111-1111-111111111111';
const REQ = '33333333-3333-3333-3333-333333333333';
const AUTOR = '44444444-4444-4444-4444-444444444444';

/** Fabrica o erro de deadlock/conflito de escrita que aciona o retry (`erroDeContencaoTransitoria`). */
function erroDeContencao(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError(
    'Transaction failed due to a write conflict or a deadlock. Please retry your transaction',
    { code: 'P2034', clientVersion: '7.9.1' },
  );
}

/**
 * Um "banco" falso, chave por id de item, que simula o que uma transação
 * real veria: `update` muda o estado que a PRÓXIMA leitura (`findUniqueOrThrow`,
 * `findMany`) enxerga — é o que prova que o código relê DENTRO da transação
 * em vez de carregar o retrato de fora dela (achado Critical C1 da revisão).
 *
 * Simplificação deliberada: `findMany` devolve TODOS os itens do banco falso,
 * sem filtrar por `requisicaoId` — em todo teste deste arquivo há uma única
 * requisição, então filtrar não mudaria resultado nenhum.
 */
function montar(
  itensIniciais: Array<Record<string, unknown>>,
  opts: { semSaldo?: boolean; comNotificacaoDeKit?: boolean } = {},
) {
  const chamadas: string[] = [];
  const itensDb = new Map(itensIniciais.map((i) => [i.id as string, { ...i }]));
  // Estado fake da COLUNA `requisicaoMaterial.status` — só existe para o
  // guard `where: { status: { not: 'separada' } }` (achado Important I3 da
  // rodada 2) ter algo real para checar entre chamadas sucessivas dentro do
  // MESMO teste (ver "dois POSTs sequenciais" abaixo).
  let statusDaRequisicao = 'pendente';

  const tx = {
    $queryRaw: jest.fn(async () => {
      chamadas.push('LOCK');
      if (opts.semSaldo) return [];
      return [{ saldo_separado: '0' }];
    }),
    $executeRaw: jest.fn(async () => {
      chamadas.push('UPDATE saldo');
      return 1;
    }),
    requisicaoMaterial: {
      findFirst: jest.fn().mockResolvedValue({
        id: REQ,
        companyId: COMPANY,
        status: 'pendente',
        serviceOrderId: 'os-1',
        depositoId: 'dep-1',
        itens: itensIniciais,
        numero: 'REQ-2026-001',
        // Task 8: `executarSeparacao` lê `req.serviceOrder.protocolo` para
        // `notificarKitCompleto` quando o kit fecha — sem isto o teste
        // quebra com "Cannot read properties of undefined", não com uma
        // asserção de negócio.
        serviceOrder: { protocolo: 'OS-2026-047' },
      }),
      // Achado Important I3 da rodada 2: `executarSeparacao` passou de
      // `.update` incondicional para `.updateMany` condicionado a
      // `status: { not: 'separada' }` SÓ quando o status calculado é
      // `separada` — a notificação só dispara quando ESTA chamada de fato
      // fecha o kit (transição), não sempre que o kit ESTÁ fechado (estado).
      // `statusDaRequisicao` simula a coluna real: uma segunda chamada, com
      // o kit já `separada`, casa zero linhas no `updateMany`.
      updateMany: jest.fn(async ({ where, data }: {
        where: { id: string; status?: { not: string } };
        data: { status: string };
      }) => {
        chamadas.push('UPDATE requisicao');
        // `where.status` ausente = SEM RESTRIÇÃO (semântica real do
        // Prisma) — assim, remover a guarda de produção faz o `count`
        // continuar `1` em toda chamada (inclusive numa repetida), em vez
        // de travar o mock com um acesso a `undefined.not`.
        if (where.status?.not !== undefined && statusDaRequisicao === where.status.not) {
          return { count: 0 };
        }
        statusDaRequisicao = data.status;
        return { count: 1 };
      }),
      // Achado Critical N1 da rodada 3: a guarda acima NÃO pode ser a única
      // escrita — uma reconferência que REBAIXA o status (ou uma
      // reconfirmação redundante do kit já fechado) grava por aqui,
      // incondicional. Sem isto, o banco fake ficaria preso em `separada`
      // mesmo quando a produção tenta gravar `em_separacao` — o mesmo
      // defeito que o N1 documentou no banco de verdade.
      update: jest.fn(async ({ data }: { data: { status?: string } }) => {
        chamadas.push('UPDATE requisicao');
        if (data.status !== undefined) statusDaRequisicao = data.status;
        return {};
      }),
    },
    requisicaoMaterialItem: {
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
      findMany: jest.fn(async () => [...itensDb.values()].map((i) => ({ ...i }))),
    },
    // Task 8: `usuariosDoAlmoxarifado` (chamada por `notificarKitCompleto`
    // quando o kit fecha) começa por aqui. Por padrão `[]` mantém o
    // comportamento dos testes que já existiam (sem destinatário, sem
    // escrita — mesmo branch coberto em `almoxarifado-notificacoes.spec.ts`).
    //
    // Achado Important da rodada 1 de correção: nenhum teste deste arquivo
    // passava pelo ramo COM destinatário — trocar a chamada a
    // `notificarKitCompleto` por `Promise.resolve()` no serviço continuava
    // 190/190 verde. `opts.comNotificacaoDeKit` fecha essa lacuna (ver os
    // testes "(integração)" abaixo), sem mudar o default de mais nada.
    companyRole: {
      findMany: jest.fn(async () => (opts.comNotificacaoDeKit ? [{ id: 'cargo-almox' }] : [])),
    },
    operator: {
      findMany: jest.fn(async () => (opts.comNotificacaoDeKit ? [{ companyUserId: 'user-almox' }] : [])),
    },
    company: {
      findUnique: jest.fn().mockResolvedValue({ legacyId: 'leg-1' }),
    },
    // Achado minor n2 da rodada 3: este `tx.notificacao` NUNCA deve ser
    // tocado pela produção (`montarNotificacaoKitCompleto` só MONTA linhas;
    // quem grava é `enviarNotificacoes(this.prisma, ...)`). Um `jest.fn()`
    // PRÓPRIO — diferente do de `prisma.notificacao` abaixo — para que um
    // regresso que movesse a gravação para dentro da transação (usando
    // `tx`) reprove em vez de passar despercebido.
    notificacao: {
      createMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    serviceOrder: {
      updateMany: jest.fn(async () => {
        chamadas.push('UPDATE os');
        return { count: 1 };
      }),
    },
  };
  const prisma = {
    $transaction: jest.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
    // A leitura da requisição (para validar TUDO antes de abrir a transação)
    // usa `this.prisma`, não `tx` — igual a um `PrismaService` de verdade, em
    // que o mesmo delegate de modelo atende fora e dentro de `$transaction`.
    requisicaoMaterial: tx.requisicaoMaterial,
    // Achado Important I4 da rodada 2 / minor n2 da rodada 3:
    // `enviarNotificacoes` grava com `this.prisma` DEPOIS do commit — nunca
    // com `tx`. `jest.fn()` PRÓPRIO, não `tx.notificacao`.
    notificacao: {
      createMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
  };
  return { servico: new AlmoxarifadoService(prisma as never), prisma, tx, chamadas, itensDb };
}

const item = (p = {}) => ({
  id: 'it-1',
  pecaId: 'p-1',
  quantidadeReservada: 4,
  quantidadeSeparada: 0,
  status: 'reservada',
  impeditivo: true,
  divergencia: null,
  ...p,
});

describe('separarItens', () => {
  it('trava a linha do saldo antes de mexer no separado', async () => {
    const { servico, chamadas } = montar([item()]);
    await servico.separarItens({
      companyId: COMPANY, requisicaoId: REQ, autorCompanyUserId: AUTOR,
      itens: [{ itemId: 'it-1', quantidade: 4 }],
    });
    expect(chamadas[0]).toBe('LOCK');
    expect(chamadas).toContain('UPDATE saldo');
  });

  it('conferir tudo fecha o kit e leva a OS a materiais_separados', async () => {
    const { servico } = montar([item()]);
    const r = await servico.separarItens({
      companyId: COMPANY, requisicaoId: REQ, autorCompanyUserId: AUTOR,
      itens: [{ itemId: 'it-1', quantidade: 4 }],
    });
    expect(r.statusRequisicao).toBe('separada');
    expect(r.statusMateriais).toBe('materiais_separados');
  });

  it('conferir em parte deixa a requisição em separação', async () => {
    const { servico } = montar([item()]);
    const r = await servico.separarItens({
      companyId: COMPANY, requisicaoId: REQ, autorCompanyUserId: AUTOR,
      itens: [{ itemId: 'it-1', quantidade: 2 }],
    });
    expect(r.statusRequisicao).toBe('em_separacao');
    expect(r.statusMateriais).toBe('aguardando_separacao');
  });

  it('separar mais do que o reservado é recusado com mensagem', async () => {
    const { servico, prisma } = montar([item()]);
    await expect(servico.separarItens({
      companyId: COMPANY, requisicaoId: REQ, autorCompanyUserId: AUTOR,
      itens: [{ itemId: 'it-1', quantidade: 9 }],
    })).rejects.toThrow(/4 reservado/);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('item que não pertence à requisição é recusado', async () => {
    // Sem isto, um itemId de outra requisição faria o saldo de outra OS mexer.
    const { servico } = montar([item()]);
    await expect(servico.separarItens({
      companyId: COMPANY, requisicaoId: REQ, autorCompanyUserId: AUTOR,
      itens: [{ itemId: 'it-de-outra', quantidade: 1 }],
    })).rejects.toThrow();
  });

  it('divergência registrada não deixa o kit fechar', async () => {
    // Spec funcional, pág. 6: "divergência impede a liberação".
    const { servico } = montar([item()]);
    const r = await servico.separarItens({
      companyId: COMPANY, requisicaoId: REQ, autorCompanyUserId: AUTOR,
      itens: [{ itemId: 'it-1', quantidade: 4, divergencia: 'veio avariada' }],
    });
    expect(r.statusRequisicao).toBe('em_separacao');
  });

  // --- Achados da revisão desta task -------------------------------------

  it('Critical C1: item repetido no mesmo pedido é recusado antes de abrir transação', async () => {
    // O vetor mais simples do achado: um POST só com o mesmo itemId duas
    // vezes dobraria o delta gravado em `saldo_separado` se isto não existisse.
    const { servico, prisma } = montar([item()]);
    await expect(servico.separarItens({
      companyId: COMPANY, requisicaoId: REQ, autorCompanyUserId: AUTOR,
      itens: [
        { itemId: 'it-1', quantidade: 4 },
        { itemId: 'it-1', quantidade: 4 },
      ],
    })).rejects.toThrow(/repetido/);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('Critical C1: o delta usa a quantidade JÁ separada relida na transação, não o retrato de fora dela', async () => {
    // Achado da re-revisão: `itensIniciais` (o que `findFirst` devolve FORA
    // da transação) mostra `quantidadeSeparada: 0` — mas o "banco" (`itensDb`,
    // o que `findUniqueOrThrow` lê DEPOIS da trava) já está em 2, simulando
    // uma conferência concorrente que comitou nesse meio-tempo. Semear os
    // dois iguais (como a primeira versão deste teste fazia) não discrimina
    // nada: o código antigo, que soma contra o retrato de fora, calcularia
    // exatamente o mesmo delta que o código correto quando as duas leituras
    // coincidem. Só divergindo os dois é que a leitura errada (0) e a certa
    // (2) produzem números diferentes de verdade: antigo 4 − 0 = 4, correto
    // 4 − 2 = 2.
    const { servico, tx, itensDb } = montar([item({ quantidadeSeparada: 0 })]);
    itensDb.set('it-1', { ...item(), quantidadeSeparada: 2 });

    await servico.separarItens({
      companyId: COMPANY, requisicaoId: REQ, autorCompanyUserId: AUTOR,
      itens: [{ itemId: 'it-1', quantidade: 4 }],
    });
    const chamadaUpdate = tx.$executeRaw.mock.calls[0][0] as { values: unknown[]; text: string };
    expect(Number(chamadaUpdate.values[0])).toBe(2);
    // Afirma a FORMA da escrita, não só o alvo: sem isto, nada impede
    // voltar a calcular o absoluto em JavaScript e ainda assim citar
    // `saldo_separado` no texto.
    expect(chamadaUpdate.text).toMatch(/saldo_separado\s*=\s*saldo_separado\s*\+/);
  });

  it('Critical C1: reconferir uma quantidade já integralmente separada (por outra transação) não escreve de novo', async () => {
    // Mesma lógica do teste acima, na direção oposta: de fora da transação
    // o item parece com 0 separado (`itensIniciais`), mas o banco já tem 4
    // — outra conferência já fechou este item enquanto esta chamada
    // esperava a trava. O código antigo (contra o retrato de fora, 0)
    // calcularia delta 4 e gravaria de novo, dobrando o saldo; o correto
    // relê o fresco (4), vê delta 0 e não escreve nada.
    const { servico, tx, itensDb } = montar([item({ quantidadeSeparada: 0 })]);
    itensDb.set('it-1', { ...item(), quantidadeSeparada: 4 });

    await servico.separarItens({
      companyId: COMPANY, requisicaoId: REQ, autorCompanyUserId: AUTOR,
      itens: [{ itemId: 'it-1', quantidade: 4 }],
    });
    expect(tx.$executeRaw).not.toHaveBeenCalled();
  });

  it('Critical C1: trava peca_saldos em ordem por pecaId, não pela ordem do pedido', async () => {
    const { servico, tx } = montar([
      item({ id: 'it-2', pecaId: 'p-2' }),
      item({ id: 'it-1', pecaId: 'p-1' }),
    ]);
    await servico.separarItens({
      companyId: COMPANY, requisicaoId: REQ, autorCompanyUserId: AUTOR,
      itens: [
        { itemId: 'it-2', quantidade: 4 },
        { itemId: 'it-1', quantidade: 4 },
      ],
    });
    // Se a ordenação por pecaId for removida num refactor futuro, este teste
    // falha: sem ela, duas conferências simultâneas travando as mesmas
    // linhas em ordens opostas dão deadlock (40P01), não P2002.
    const ordem = tx.requisicaoMaterialItem.update.mock.calls.map(
      (c: [{ where: { id: string } }]) => c[0].where.id,
    );
    expect(ordem).toEqual(['it-1', 'it-2']);
  });

  it('Important I3: mexe em saldo_separado, nunca em saldo_fisico — e a trava usa FOR UPDATE', async () => {
    const { servico, tx } = montar([item({ quantidadeSeparada: 2 })]);
    await servico.separarItens({
      companyId: COMPANY, requisicaoId: REQ, autorCompanyUserId: AUTOR,
      itens: [{ itemId: 'it-1', quantidade: 4 }],
    });
    const consultaLock = tx.$queryRaw.mock.calls[0][0] as { text: string };
    expect(consultaLock.text).toMatch(/FOR UPDATE/i);
    expect(consultaLock.text).toContain('saldo_separado');

    const atualizaSaldo = tx.$executeRaw.mock.calls[0][0] as { text: string };
    expect(atualizaSaldo.text).toContain('saldo_separado');
    expect(atualizaSaldo.text).not.toContain('saldo_fisico');
    // A FORMA da escrita, não só o alvo: sem isto, nada impede voltar a
    // calcular o absoluto em JavaScript (`SET saldo_separado = ${valor}`) —
    // o texto continuaria citando `saldo_separado` do mesmo jeito.
    expect(atualizaSaldo.text).toMatch(/saldo_separado\s*=\s*saldo_separado\s*\+/);
  });

  it('Important I2: omitir divergencia mantém a que já estava registrada', async () => {
    const { servico, itensDb } = montar([
      item({ quantidadeSeparada: 4, status: 'separada', divergencia: 'veio errada' }),
    ]);
    const r = await servico.separarItens({
      companyId: COMPANY, requisicaoId: REQ, autorCompanyUserId: AUTOR,
      itens: [{ itemId: 'it-1', quantidade: 4 }], // sem `divergencia`: não é pra mexer
    });
    expect(itensDb.get('it-1')?.divergencia).toBe('veio errada');
    // "divergência impede a liberação" continua valendo — omissão não é uma
    // forma de contornar a regra.
    expect(r.statusRequisicao).toBe('em_separacao');
  });

  it('Important I2: divergencia: null explícito apaga a divergência registrada', async () => {
    const { servico, itensDb } = montar([
      item({ quantidadeSeparada: 4, status: 'separada', divergencia: 'veio errada' }),
    ]);
    const r = await servico.separarItens({
      companyId: COMPANY, requisicaoId: REQ, autorCompanyUserId: AUTOR,
      itens: [{ itemId: 'it-1', quantidade: 4, divergencia: null }],
    });
    expect(itensDb.get('it-1')?.divergencia).toBeNull();
    expect(r.statusRequisicao).toBe('separada');
  });

  it('Important I1: divergência ao lado de um item FALTANTE ainda manda comprar, não trava em aguardando_separacao', async () => {
    // O override de divergência só pode valer quando o kit JÁ fecharia —
    // senão uma OS com peça faltante nunca aciona o fluxo de compra.
    const { servico } = montar([
      item({ id: 'it-1', pecaId: 'p-1' }),
      item({ id: 'it-2', pecaId: 'p-2', status: 'faltante', quantidadeSeparada: 0 }),
    ]);
    const r = await servico.separarItens({
      companyId: COMPANY, requisicaoId: REQ, autorCompanyUserId: AUTOR,
      itens: [{ itemId: 'it-1', quantidade: 4, divergencia: 'avariada' }],
    });
    expect(r.statusMateriais).toBe('aguardando_compra');
  });

  it('Important M1: sem linha de saldo falha alto, em vez de assumir zero', async () => {
    const { servico } = montar([item()], { semSaldo: true });
    await expect(servico.separarItens({
      companyId: COMPANY, requisicaoId: REQ, autorCompanyUserId: AUTOR,
      itens: [{ itemId: 'it-1', quantidade: 4 }],
    })).rejects.toThrow(/inconsistente/);
  });

  it('Important M2: grava atendidaEm junto com atendidaPorCompanyUserId', async () => {
    const { servico, tx } = montar([item()]);
    await servico.separarItens({
      companyId: COMPANY, requisicaoId: REQ, autorCompanyUserId: AUTOR,
      itens: [{ itemId: 'it-1', quantidade: 4 }],
    });
    const dadosGravados = tx.requisicaoMaterial.updateMany.mock.calls[0][0].data as {
      atendidaPorCompanyUserId: string;
      atendidaEm: Date;
    };
    expect(dadosGravados.atendidaPorCompanyUserId).toBe(AUTOR);
    expect(dadosGravados.atendidaEm).toBeInstanceOf(Date);
  });

  it('Important I4: contenção transitória aciona o retry da transação inteira', async () => {
    const { servico, tx, prisma } = montar([item()]);
    let tentativas = 0;
    const lockOriginal = tx.$queryRaw.getMockImplementation()!;
    tx.$queryRaw = jest.fn(async (...args: unknown[]) => {
      tentativas++;
      if (tentativas === 1) throw erroDeContencao();
      return lockOriginal(...(args as []));
    });
    const r = await servico.separarItens({
      companyId: COMPANY, requisicaoId: REQ, autorCompanyUserId: AUTOR,
      itens: [{ itemId: 'it-1', quantidade: 4 }],
    });
    expect(tentativas).toBe(2);
    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
    expect(r.statusRequisicao).toBe('separada');
  });

  it('Important I4: esgotar as tentativas por contenção vira ConflictException, não 500 cru', async () => {
    const { servico, tx, prisma } = montar([item()]);
    tx.$queryRaw = jest.fn(async () => {
      throw erroDeContencao();
    });
    await expect(servico.separarItens({
      companyId: COMPANY, requisicaoId: REQ, autorCompanyUserId: AUTOR,
      itens: [{ itemId: 'it-1', quantidade: 4 }],
    })).rejects.toThrow(ConflictException);
    // MAX_TENTATIVAS_CONCORRENCIA no serviço é 5 — mesmo teto usado pela reserva.
    expect(prisma.$transaction).toHaveBeenCalledTimes(5);
  });

  // --- Achado Important da rodada 1 de correção da Task 8 ----------------
  // Nenhum teste acima passa pelo ramo COM destinatário de
  // `notificarKitCompleto` — o coordenador provou trocando a chamada por
  // `Promise.resolve()` no serviço e vendo a suíte inteira continuar verde.
  // Os dois testes abaixo fecham essa lacuna: o positivo prova que a
  // notificação SAI quando o kit fecha e alguém tem acesso ao almoxarifado;
  // o negativo (par obrigatório) prova que ela NÃO sai quando o kit não
  // fecha — sem ele, o positivo não provaria que o `if` está no lugar
  // certo, só que a função de notificação funciona isolada.

  it('kit fechando com destinatário no almoxarifado grava a notificação (integração)', async () => {
    const { servico, prisma, tx } = montar([item()], { comNotificacaoDeKit: true });
    const r = await servico.separarItens({
      companyId: COMPANY, requisicaoId: REQ, autorCompanyUserId: AUTOR,
      itens: [{ itemId: 'it-1', quantidade: 4 }],
    });

    expect(r.statusRequisicao).toBe('separada');
    // Achado minor n2 da rodada 3: a gravação usou o client EXTERNO
    // (`this.prisma`, depois do commit) — nunca `tx`. Com os dois mocks
    // agora DIFERENTES, um regresso que movesse a gravação para dentro da
    // transação reprovaria aqui.
    expect(tx.notificacao.createMany).not.toHaveBeenCalled();
    expect(prisma.notificacao.createMany).toHaveBeenCalledTimes(1);
    const linha = prisma.notificacao.createMany.mock.calls[0][0].data[0] as {
      destinatarioId: string; referenciaTipo: string; referenciaId: string; mensagem: string;
    };
    expect(linha.destinatarioId).toBe('user-almox');
    expect(linha.referenciaTipo).toBe('requisicao_material');
    expect(linha.referenciaId).toBe(REQ);
    expect(linha.mensagem).toContain('REQ-2026-001');
    expect(linha.mensagem).toContain('OS-2026-047');
    // Achado minor m5 da revisão: os campos que decidem se a notificação é
    // VISÍVEL (sino certo, tenant certo) não eram assertados por nada — o
    // `tsc` só garante a PRESENÇA (NOT NULL sem default), nunca o VALOR.
    const linhaCompleta = prisma.notificacao.createMany.mock.calls[0][0].data[0] as {
      destinatarioTipo: string; prefeituraLegacyId: string;
    };
    expect(linhaCompleta.destinatarioTipo).toBe('company_user');
    expect(linhaCompleta.prefeituraLegacyId).toBe('leg-1');
  });

  it('kit em separação PARCIAL não notifica ninguém, mesmo com destinatário disponível (par negativo)', async () => {
    const { servico, prisma } = montar([item()], { comNotificacaoDeKit: true });
    const r = await servico.separarItens({
      companyId: COMPANY, requisicaoId: REQ, autorCompanyUserId: AUTOR,
      itens: [{ itemId: 'it-1', quantidade: 2 }], // reservado 4, confere só 2: kit não fecha
    });

    expect(r.statusRequisicao).toBe('em_separacao');
    expect(prisma.notificacao.createMany).not.toHaveBeenCalled();
  });

  it('dois POSTs sequenciais que fecham o MESMO kit geram UMA notificação só (achado Important I3)', async () => {
    // Não é concorrência (isso é o m5, fora de escopo) — é o mesmo POST
    // repetido (duplo clique, front que reenvia). Sem o guard de transição
    // (`status: { not: 'separada' }`), o segundo POST recalcularia
    // `statusRequisicao: 'separada'` de novo e notificaria o almoxarife
    // pela segunda vez do MESMO evento.
    const { servico, prisma } = montar([item()], { comNotificacaoDeKit: true });
    const chamar = () => servico.separarItens({
      companyId: COMPANY, requisicaoId: REQ, autorCompanyUserId: AUTOR,
      itens: [{ itemId: 'it-1', quantidade: 4 }],
    });

    const r1 = await chamar();
    const r2 = await chamar();

    expect(r1.statusRequisicao).toBe('separada');
    expect(r2.statusRequisicao).toBe('separada'); // resposta não muda de forma nem de conteúdo
    expect(prisma.notificacao.createMany).toHaveBeenCalledTimes(1);
  });
});
