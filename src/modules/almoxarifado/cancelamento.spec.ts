import { ConflictException } from '@nestjs/common';
import { AlmoxarifadoService } from './almoxarifado.service';

const COMPANY = '11111111-1111-1111-1111-111111111111';
const REQ = '33333333-3333-3333-3333-333333333333';
const AUTOR = '44444444-4444-4444-4444-444444444444';

function montar(status: string, itens: unknown[], opts: { semSaldo?: boolean } = {}) {
  const chamadas: string[] = [];
  const tx = {
    $queryRaw: jest.fn(async (query: { text: string }) => {
      // Fundação da F4: a primeira trava é a da REQUISIÇÃO — rótulo próprio.
      if (query.text.includes('requisicoes_material')) {
        chamadas.push('LOCK requisicao');
        return [{ id: REQ }];
      }
      chamadas.push('LOCK');
      return opts.semSaldo ? [] : [{ saldo_reservado: '4' }];
    }),
    $executeRaw: jest.fn(async (sql: { text?: string }) => {
      chamadas.push('UPDATE saldo');
      return 1;
    }),
    requisicaoMaterial: {
      findFirst: jest.fn().mockResolvedValue({
        id: REQ, companyId: COMPANY, status, serviceOrderId: 'os-1', depositoId: 'dep-1', itens,
      }),
      updateMany: jest.fn(async () => { chamadas.push('UPDATE requisicao'); return { count: 1 }; }),
    },
    requisicaoMaterialItem: {
      updateMany: jest.fn(async () => { chamadas.push('UPDATE itens'); return { count: 1 }; }),
      // Retrato "sem divergência": bate com `reservado()` abaixo, com status
      // ainda aberto (não `entregue`/`cancelada`) para não cair no guard
      // pós-trava. Os testes que precisam provar a releitura (ou o guard de
      // status) sobrescrevem isto por instância.
      findUniqueOrThrow: jest.fn().mockResolvedValue({
        status: 'reservada', quantidadeReservada: 4, quantidadeSeparada: 0,
      }),
    },
    serviceOrder: { updateMany: jest.fn(async () => ({ count: 1 })) },
  };
  const prisma = { $transaction: jest.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)) };
  return { servico: new AlmoxarifadoService(prisma as never), prisma, tx, chamadas };
}

const reservado = () => ({
  id: 'it-1', pecaId: 'p-1', quantidadeReservada: 4, quantidadeSeparada: 0,
  status: 'reservada', impeditivo: true,
});

describe('cancelarRequisicao', () => {
  it('devolve o reservado ao disponível', async () => {
    // É a razão de esta operação existir: sem ela, OS abandonada tranca peça.
    const { servico, chamadas } = montar('pendente', [reservado()]);
    await servico.cancelarRequisicao({
      companyId: COMPANY, requisicaoId: REQ, autorCompanyUserId: AUTOR,
      motivo: 'OS aberta por engano',
    });
    // A requisição primeiro (fundação da F4), depois a linha de saldo.
    expect(chamadas.slice(0, 2)).toEqual(['LOCK requisicao', 'LOCK']);
    expect(chamadas).toContain('UPDATE saldo');
  });

  it('exige motivo — o CHECK do banco recusaria de qualquer forma', async () => {
    const { servico } = montar('pendente', [reservado()]);
    await expect(servico.cancelarRequisicao({
      companyId: COMPANY, requisicaoId: REQ, autorCompanyUserId: AUTOR, motivo: '   ',
    })).rejects.toThrow(/motivo/i);
  });

  it('requisição já entregue não é cancelada', async () => {
    // A peça já saiu do estoque; desfazer isso é devolução, e devolução é F5.
    // Achado minor m3 da revisão: a guarda tem de vir ANTES de tocar o saldo.
    // Só a trava da própria requisição roda antes do throw (fundação da F4: é
    // ela que torna confiável o status lido) — nenhuma trava nem escrita de saldo.
    const { servico, chamadas } = montar('entregue', [reservado()]);
    await expect(servico.cancelarRequisicao({
      companyId: COMPANY, requisicaoId: REQ, autorCompanyUserId: AUTOR, motivo: 'x',
    })).rejects.toBeInstanceOf(ConflictException);
    expect(chamadas).toEqual(['LOCK requisicao']);
  });

  it('devolve a quantidade RELIDA na transação, não a do retrato', async () => {
    // Achado Important I1 da revisão: o retrato (`reservado()`) e o fresco
    // têm de divergir nos DOIS eixos (reservada E separada) — divergir só um
    // deixava uma implementação que lê `saldo_reservado` do retrato passar
    // igual, porque o valor coincidia por acaso. Aqui o retrato diz 4/0 e o
    // banco diz 3/2 — reservada E separada DIFERENTES ENTRE SI, não só do
    // retrato. Achado n1 da re-revisão: com o par fresco em 3/3 (valores
    // IGUAIS entre si), trocar `saldo_reservado` por `saldo_separado` no
    // `UPDATE` passa despercebido — a asserção posicional não reprova uma
    // troca entre dois valores idênticos. Com 3/2, a mesma troca inverte o
    // par e `toEqual([3, 2])` reprova.
    const { servico, tx } = montar('pendente', [reservado()]);
    tx.requisicaoMaterialItem.findUniqueOrThrow = jest.fn().mockResolvedValue({
      status: 'separada', quantidadeReservada: 3, quantidadeSeparada: 2,
    });

    await servico.cancelarRequisicao({
      companyId: COMPANY, requisicaoId: REQ, autorCompanyUserId: AUTOR, motivo: 'engano',
    });

    const sql = tx.$executeRaw.mock.calls[0][0];
    expect(sql.values.slice(0, 2)).toEqual([3, 2]);
    // Achado I1 da re-revisão (rodada 2): as duas redes acima olham eixos
    // INDEPENDENTES — `values.slice(0,2)` fixa a ORDEM dos parâmetros,
    // `sql.text` (versão anterior) só conferia que CADA coluna aparecia
    // decrementada por *algo*. Nenhuma amarrava parâmetro a coluna, e
    // trocar os NOMES das colunas mantendo os parâmetros na mesma posição
    // (`SET saldo_separado = saldo_separado - $1, saldo_reservado =
    // saldo_reservado - $2`) passava nas duas: é semanticamente idêntico à
    // troca de valores que a asserção acima pega, só que move as cláusulas
    // `SET` em vez dos valores. `$1`/`$2` são os índices REAIS do
    // `Prisma.sql` desta query (conferidos: `$1` = quantidadeReservada,
    // `$2` = quantidadeSeparada, `$3`/`$4` = pecaId/depositoId no WHERE) —
    // amarrar o número ao nome fecha a lacuna nos dois sentidos.
    expect(sql.text).toMatch(/saldo_reservado\s*=\s*saldo_reservado\s*-\s*\$1\b/);
    expect(sql.text).toMatch(/saldo_separado\s*=\s*saldo_separado\s*-\s*\$2\b/);
  });

  it('trava peca_saldos SEMPRE na mesma ordem por pecaId — evita deadlock com uma entrega concorrente (achado n2)', async () => {
    // Os outros 8 testes deste arquivo usam um único item, então o
    // comparador de ordem de trava (idêntico ao de `executarReserva`/
    // `executarSeparacao`/`executarEntrega`: `pa < pb ? -1 : pa > pb ? 1 : 0`
    // sobre `pecaId ?? ''`) nunca era exercido. Sem este teste, a próxima
    // mudança nele passaria em silêncio — e é essa ordem única entre
    // cancelamento e entrega concorrentes que evita deadlock (40P01).
    // Mesmo padrão de `reserva.spec.ts:351`: o PEDIDO cita p-2 antes de
    // p-1, a ordem oposta da ordenação por id.
    const { servico, tx } = montar('pendente', [
      { ...reservado(), id: 'it-2', pecaId: 'p-2' },
      { ...reservado(), id: 'it-1', pecaId: 'p-1' },
    ]);

    await servico.cancelarRequisicao({
      companyId: COMPANY, requisicaoId: REQ, autorCompanyUserId: AUTOR, motivo: 'engano',
    });

    const primeiroValor = (chamada: unknown[]) => (chamada[0] as { values: unknown[] }).values[0];
    // A requisição primeiro (fundação da F4), depois o saldo por `pecaId`.
    expect(tx.$queryRaw.mock.calls.map(primeiroValor)).toEqual([REQ, 'p-1', 'p-2']);
  });

  it('não devolve saldo de item que uma entrega concorrente já fechou', async () => {
    // Achado Critical C1 (fix 1). Cenário: `cancelarRequisicao` leu o status
    // da REQUISIÇÃO como `separada` antes da trava (retrato pré-trava), mas
    // enquanto esperava o `FOR UPDATE` uma entrega concorrente commitou e
    // fechou ESTE ITEM como `entregue` — sem zerar `quantidadeReservada`/
    // `quantidadeSeparada` (é assim que `executarEntrega` grava no ramo
    // `separado > 0`). Se o cancelamento devolvesse o saldo relido (4/4)
    // mesmo assim, o saldo ganharia 4 unidades fantasma — exatamente o C1
    // documentado no brief. A prova obrigatória (remover o guard) está no
    // relatório da task.
    const { servico, tx, chamadas } = montar('separada', [reservado()]);
    tx.requisicaoMaterialItem.findUniqueOrThrow = jest.fn().mockResolvedValue({
      status: 'entregue', quantidadeReservada: 4, quantidadeSeparada: 4,
    });

    await servico.cancelarRequisicao({
      companyId: COMPANY, requisicaoId: REQ, autorCompanyUserId: AUTOR, motivo: 'engano',
    });

    expect(tx.$executeRaw).not.toHaveBeenCalled();
    expect(chamadas).not.toContain('UPDATE saldo');
  });

  it('recusa fechar a requisição se outra chamada já a fechou durante a transação', async () => {
    // Achado Critical C1 (fix 2). Se `requisicaoMaterial.updateMany` não casar
    // nenhuma linha (a requisição foi fechada — entregue ou cancelada — por
    // outra chamada enquanto esta transação corria), o método TEM de recusar
    // em vez de devolver 200: o `throw` é o que faz o Prisma dar ROLLBACK nos
    // decrementos de saldo que o laço já tiver feito.
    const { servico, tx } = montar('pendente', [reservado()]);
    tx.requisicaoMaterial.updateMany = jest.fn(async () => ({ count: 0 }));

    await expect(servico.cancelarRequisicao({
      companyId: COMPANY, requisicaoId: REQ, autorCompanyUserId: AUTOR, motivo: 'engano',
    })).rejects.toThrow(/fechada por outra operação/i);
  });

  it('fecha a requisição e os itens com os campos de auditoria e o zeramento', async () => {
    // Achado Important I2 da revisão: nenhum teste olhava os argumentos do
    // `UPDATE requisicao`/`UPDATE itens`. Sem isto, uma implementação que
    // esquecesse `motivoCancelamento` (bate no CHECK `req_cancelamento_com_motivo`
    // em produção) ou que não zerasse `quantidadeReservada`/`quantidadeSeparada`
    // dos itens (reabrindo a corrida cancelamento × cancelamento, hoje fechada
    // só por causa desse zeramento) passaria com a suíte inteira verde.
    const { servico, tx } = montar('pendente', [reservado()]);

    await servico.cancelarRequisicao({
      companyId: COMPANY, requisicaoId: REQ, autorCompanyUserId: AUTOR, motivo: '  motivo do cancelamento  ',
    });

    const argsReq = tx.requisicaoMaterial.updateMany.mock.calls[0][0];
    expect(argsReq.where).toEqual({ id: REQ, status: { notIn: ['entregue', 'cancelada'] } });
    expect(argsReq.data.status).toBe('cancelada');
    expect(argsReq.data.canceladaEm).toBeInstanceOf(Date);
    expect(argsReq.data.canceladaPorCompanyUserId).toBe(AUTOR);
    expect(argsReq.data.motivoCancelamento).toBe('motivo do cancelamento');

    const argsItens = tx.requisicaoMaterialItem.updateMany.mock.calls[0][0];
    expect(argsItens.where).toEqual({ requisicaoId: REQ, status: { notIn: ['entregue', 'cancelada'] } });
    expect(argsItens.data).toEqual({ status: 'cancelada', quantidadeReservada: 0, quantidadeSeparada: 0 });
  });

  it('a OS volta a planejada — sem materiais, sem promessa', async () => {
    const { servico, tx } = montar('pendente', [reservado()]);
    await servico.cancelarRequisicao({
      companyId: COMPANY, requisicaoId: REQ, autorCompanyUserId: AUTOR, motivo: 'engano',
    });
    expect(tx.serviceOrder.updateMany.mock.calls[0][0].data.statusMateriais).toBe('planejada');
  });

  // --- Fundação da F4 e achados da revisão final da F3 ---------------------

  it('fundação F4: trava a requisição ANTES de ler o status dela', async () => {
    const { servico, tx } = montar('pendente', [reservado()]);
    await servico.cancelarRequisicao({
      companyId: COMPANY, requisicaoId: REQ, autorCompanyUserId: AUTOR, motivo: 'engano',
    });
    expect(tx.$queryRaw.mock.invocationCallOrder[0])
      .toBeLessThan(tx.requisicaoMaterial.findFirst.mock.invocationCallOrder[0]);
  });

  it('I5 (revisão final da F3): sem linha de saldo falha alto, em vez de devolver nada em silêncio', async () => {
    // `FOR UPDATE` não trava linha que não existe: sem a guarda, o UPDATE
    // casaria zero linhas e o item ainda seria fechado como cancelado.
    const { servico, tx } = montar('pendente', [reservado()], { semSaldo: true });
    await expect(servico.cancelarRequisicao({
      companyId: COMPANY, requisicaoId: REQ, autorCompanyUserId: AUTOR, motivo: 'engano',
    })).rejects.toThrow(/Saldo não encontrado/);
    expect(tx.$executeRaw).not.toHaveBeenCalled();
  });
});
