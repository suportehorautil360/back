import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '../../../prisma/generated/client';
import {
  ANO,
  COMPRADOR,
  DEPOSITO,
  DEPOSITO_DE_FORA,
  EMPRESA,
  OUTRA_EMPRESA,
  PECA_A,
  PECA_B,
  PECA_C,
  PECA_DE_FORA,
  PECA_INATIVA,
  montarBancoFalso,
} from './banco-falso.fake-spec';

const dia = (d: string) => new Date(`${d}T12:00:00Z`);

describe('listarSolicitacoes — a fila de Compras', () => {
  it('status desconhecido: 400 SEM consultar o banco', async () => {
    const { servico, prisma } = montarBancoFalso();
    await expect(servico.listarSolicitacoes(EMPRESA, 'aberta')).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.solicitacaoCompra.findMany).not.toHaveBeenCalled();
  });

  it('sem status: pendentes e em cotação desta empresa, na ordem do §8 (prioridade, menor data dos itens, quem pediu antes)', async () => {
    const b = montarBancoFalso();
    b.plantarSolicitacao({ id: 'sc-normal', numero: 'SC-1', prioridade: 'normal', createdAt: dia('2026-09-01'), itens: [{ id: 'i-normal', pecaId: PECA_A, quantidade: 1 }] });
    b.plantarSolicitacao({ id: 'sc-em-cotacao', numero: 'SC-2', status: 'em_cotacao', prioridade: 'normal', createdAt: dia('2026-08-30'), itens: [{ id: 'i-cot', pecaId: PECA_A, quantidade: 1 }] });
    b.plantarSolicitacao({
      id: 'sc-alta-tarde', numero: 'SC-3', prioridade: 'alta', createdAt: dia('2026-09-02'),
      itens: [{ id: 'i-tarde', pecaId: PECA_A, quantidade: 1, dataNecessidade: dia('2026-09-25') }],
    });
    // A PRIMEIRA data desta é mais tarde que a da anterior; a MENOR é mais cedo.
    // Ordenar pela data do primeiro item a poria atrás — errado.
    b.plantarSolicitacao({
      id: 'sc-alta-cedo', numero: 'SC-4', prioridade: 'alta', createdAt: dia('2026-09-05'),
      itens: [
        { id: 'i-cedo-1', pecaId: PECA_A, quantidade: 1, dataNecessidade: dia('2026-09-29') },
        { id: 'i-cedo-2', pecaId: PECA_B, quantidade: 1, dataNecessidade: dia('2026-09-20') },
      ],
    });
    b.plantarSolicitacao({ id: 'sc-alta-sem-data', numero: 'SC-5', prioridade: 'alta', createdAt: dia('2026-09-01'), itens: [{ id: 'i-sem', pecaId: PECA_A, quantidade: 1 }] });
    b.plantarSolicitacao({ id: 'sc-critica', numero: 'SC-6', prioridade: 'critica', createdAt: dia('2026-09-08'), itens: [{ id: 'i-crit', pecaId: PECA_A, quantidade: 1 }] });
    b.plantarSolicitacao({ id: 'sc-aprovada', numero: 'SC-7', status: 'aprovada', prioridade: 'critica', itens: [{ id: 'i-apr', pecaId: PECA_A, quantidade: 1 }] });
    b.plantarSolicitacao({
      id: 'sc-de-fora', numero: 'SC-8', companyId: OUTRA_EMPRESA, depositoId: DEPOSITO_DE_FORA, prioridade: 'critica',
      itens: [{ id: 'i-fora', pecaId: PECA_DE_FORA, quantidade: 1 }],
    });

    const fila = await b.servico.listarSolicitacoes(EMPRESA);

    expect(fila.map((s) => s.id)).toEqual([
      'sc-critica', 'sc-alta-cedo', 'sc-alta-tarde', 'sc-alta-sem-data', 'sc-em-cotacao', 'sc-normal',
    ]);
    expect((await b.servico.listarSolicitacoes(EMPRESA, 'aprovada')).map((s) => s.id)).toEqual(['sc-aprovada']);
  });

  it('forma: números como number e a situação de cada item pelas origens (OC cancelada não conta)', async () => {
    const b = montarBancoFalso();
    b.plantarSolicitacao({ id: 'sc-1', numero: `SC-${ANO}-001`, itens: [{ id: 'sci-1', pecaId: PECA_A, quantidade: 10 }] });
    b.plantarOrdem({ id: 'oc-r', numero: `OC-${ANO}-001`, status: 'rascunho', itens: [{ id: 'oci-r', pecaId: PECA_A, quantidade: 3, valorUnit: 1, origens: [{ id: 'o-r', solicitacaoCompraItemId: 'sci-1', quantidade: 3 }] }] });
    b.plantarOrdem({ id: 'oc-e', numero: `OC-${ANO}-002`, status: 'emitida', itens: [{ id: 'oci-e', pecaId: PECA_A, quantidade: 4, valorUnit: 1, origens: [{ id: 'o-e', solicitacaoCompraItemId: 'sci-1', quantidade: 4 }] }] });
    b.plantarOrdem({ id: 'oc-c', numero: `OC-${ANO}-003`, status: 'cancelada', itens: [{ id: 'oci-c', pecaId: PECA_A, quantidade: 2, valorUnit: 1, origens: [{ id: 'o-c', solicitacaoCompraItemId: 'sci-1', quantidade: 2 }] }] });

    const sc = await b.servico.detalharSolicitacao(EMPRESA, 'sc-1');

    expect(sc).toMatchObject({
      id: 'sc-1', numero: `SC-${ANO}-001`, origem: 'manual', status: 'pendente',
      deposito: { id: DEPOSITO, nome: 'Almoxarifado Central' }, serviceOrder: null,
    });
    expect(sc.itens).toEqual([
      expect.objectContaining({
        id: 'sci-1',
        peca: { id: PECA_A, codigoInterno: 'ALM-000001', descricao: 'Filtro de óleo', unidade: 'un' },
        quantidade: 10, status: 'aberta', requisicaoItemId: null,
        comprado: 4, emCotacao: 3, recebido: 0, disponivelParaCotar: 3,
      }),
    ]);
  });

  it('item de solicitação cancelada não oferece nada para cotar', async () => {
    const b = montarBancoFalso();
    b.plantarSolicitacao({ id: 'sc-c', numero: 'SC-C', status: 'cancelada', itens: [{ id: 'sci-c', pecaId: PECA_A, quantidade: 5, status: 'cancelada' }] });
    const sc = await b.servico.detalharSolicitacao(EMPRESA, 'sc-c');
    expect(sc.itens[0].disponivelParaCotar).toBe(0);
  });

  it('detalhar solicitação de outra empresa: 404', async () => {
    const b = montarBancoFalso();
    b.plantarSolicitacao({ id: 'sc-de-fora', numero: 'SC-X', companyId: OUTRA_EMPRESA, depositoId: DEPOSITO_DE_FORA, itens: [{ id: 'i', pecaId: PECA_DE_FORA, quantidade: 1 }] });
    await expect(b.servico.detalharSolicitacao(EMPRESA, 'sc-de-fora')).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('criarSolicitacao — manual', () => {
  const pedido = (extra: object = {}) => ({
    companyId: EMPRESA,
    autorCompanyUserId: COMPRADOR,
    depositoId: DEPOSITO,
    prioridade: 'alta',
    justificativa: '  Reposição da oficina volante  ',
    itens: [
      { pecaId: PECA_A, quantidade: 4 },
      { pecaId: PECA_B, quantidade: 12.5 },
    ],
    ...extra,
  });

  it('peça repetida: 400 antes de qualquer consulta', async () => {
    const b = montarBancoFalso();
    await expect(
      b.servico.criarSolicitacao(pedido({ itens: [{ pecaId: PECA_A, quantidade: 1 }, { pecaId: PECA_A, quantidade: 2 }] })),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(b.prisma.peca.findMany).not.toHaveBeenCalled();
    expect(b.prisma.$transaction).not.toHaveBeenCalled();
  });

  it.each([
    ['de outra empresa', PECA_DE_FORA],
    ['inativa', PECA_INATIVA],
  ])('peça %s: 400 citando a peça, sem abrir transação', async (_rotulo, pecaId) => {
    const b = montarBancoFalso();
    const erro = await b.servico.criarSolicitacao(pedido({ itens: [{ pecaId, quantidade: 1 }] })).catch((e: unknown) => e);
    expect(erro).toBeInstanceOf(BadRequestException);
    expect((erro as Error).message).toContain(pecaId);
    expect(b.prisma.$transaction).not.toHaveBeenCalled();
  });

  it('depósito de outra empresa: 404 sem abrir transação', async () => {
    const b = montarBancoFalso();
    await expect(b.servico.criarSolicitacao(pedido({ depositoId: DEPOSITO_DE_FORA }))).rejects.toBeInstanceOf(NotFoundException);
    expect(b.prisma.$transaction).not.toHaveBeenCalled();
  });

  it('justificativa só com espaço e 2 letras: 400', async () => {
    const b = montarBancoFalso();
    await expect(b.servico.criarSolicitacao(pedido({ justificativa: '  ab  ' }))).rejects.toBeInstanceOf(BadRequestException);
  });

  it('grava origem manual, pendente, solicitante do painel, itens sem requisição e com a prioridade do cabeçalho; número continua o ano', async () => {
    const b = montarBancoFalso();
    b.plantarSolicitacao({ id: 'sc-1', numero: `SC-${ANO}-001`, itens: [{ id: 'x1', pecaId: PECA_C, quantidade: 1 }] });
    b.plantarSolicitacao({ id: 'sc-2', numero: `SC-${ANO}-002`, itens: [{ id: 'x2', pecaId: PECA_C, quantidade: 1 }] });
    b.plantarSolicitacao({ id: 'sc-velha', numero: `SC-${ANO - 1}-900`, itens: [{ id: 'x3', pecaId: PECA_C, quantidade: 1 }] });
    b.plantarSolicitacao({ id: 'sc-fora', numero: `SC-${ANO}-050`, companyId: OUTRA_EMPRESA, depositoId: DEPOSITO_DE_FORA, itens: [{ id: 'x4', pecaId: PECA_DE_FORA, quantidade: 1 }] });

    const r = await b.servico.criarSolicitacao(pedido());

    expect(r).toEqual({ id: expect.any(String), numero: `SC-${ANO}-003` });
    expect(b.banco.solicitacao(r.id)).toMatchObject({
      companyId: EMPRESA, numero: `SC-${ANO}-003`, origem: 'manual', status: 'pendente', prioridade: 'alta',
      depositoId: DEPOSITO, justificativa: 'Reposição da oficina volante', solicitanteCompanyUserId: COMPRADOR,
      serviceOrderId: null, requisicaoId: null,
    });
    const itens = b.banco.tabelas().solicitacaoItens.filter((i) => i.solicitacaoId === r.id);
    expect(itens.map((i) => ({ pecaId: i.pecaId, quantidade: i.quantidade, requisicaoItemId: i.requisicaoItemId, prioridade: i.prioridade, status: i.status })))
      .toEqual([
        { pecaId: PECA_A, quantidade: 4, requisicaoItemId: null, prioridade: 'alta', status: 'aberta' },
        { pecaId: PECA_B, quantidade: 12.5, requisicaoItemId: null, prioridade: 'alta', status: 'aberta' },
      ]);
    expect(b.banco.auditoria()).toEqual([
      expect.objectContaining({
        companyId: EMPRESA, acao: 'solicitacao_compra.criar', alvoTipo: 'suprimentos.solicitacao_compra',
        alvoId: r.id, atorId: COMPRADOR, atorNome: 'Comprador',
      }),
    ]);
  });

  it('colisão de número (P2002) é contenção: refaz a transação e grava UMA solicitação', async () => {
    const b = montarBancoFalso();
    b.ganchos.erroNoProximoCreate = {
      tabela: 'solicitacoes',
      erro: new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002', clientVersion: 'teste', meta: { target: ['companyId', 'numero'] },
      }),
    };

    const r = await b.servico.criarSolicitacao(pedido());

    expect(b.prisma.$transaction).toHaveBeenCalledTimes(2);
    expect(b.banco.tabelas().solicitacoes.map((s) => s.id)).toEqual([r.id]);
  });
});

describe('rejeitar e cancelar solicitação', () => {
  const ato = (extra: object = {}) => ({
    companyId: EMPRESA, solicitacaoId: 'sc-m', autorCompanyUserId: COMPRADOR, motivo: '  Compra feita pelo contrato anual  ', ...extra,
  });

  it.each([
    ['falta_os', 'cancelarSolicitacao'],
    ['falta_os', 'rejeitarSolicitacao'],
    ['peca_adicional', 'cancelarSolicitacao'],
  ] as const)('origem %s não é encerrada por Compras (%s): 409 e nada muda', async (origem, metodo) => {
    const b = montarBancoFalso();
    b.plantarSolicitacao({ id: 'sc-m', numero: `SC-${ANO}-010`, origem, prioridade: 'critica', itens: [{ id: 'sci-m', pecaId: PECA_A, quantidade: 2 }] });

    const erro = await b.servico[metodo](ato()).catch((e: unknown) => e);

    expect(erro).toBeInstanceOf(ConflictException);
    expect((erro as Error).message).toBe('Solicitação de falta de OS acompanha a requisição — cancele a requisição.');
    expect(b.banco.solicitacao('sc-m')?.status).toBe('pendente');
    expect(b.banco.itemDeSolicitacao('sci-m')?.status).toBe('aberta');
  });

  it('com unidade numa OC viva (rascunho e emitida): 409 dizendo em quais OCs, e nada muda', async () => {
    const b = montarBancoFalso();
    b.plantarSolicitacao({ id: 'sc-m', numero: `SC-${ANO}-010`, status: 'em_cotacao', itens: [{ id: 'sci-m', pecaId: PECA_A, quantidade: 10 }] });
    b.plantarOrdem({ id: 'oc-e', numero: `OC-${ANO}-009`, status: 'emitida', itens: [{ id: 'oci-e', pecaId: PECA_A, quantidade: 1, valorUnit: 1, origens: [{ id: 'o-e', solicitacaoCompraItemId: 'sci-m', quantidade: 1 }] }] });
    b.plantarOrdem({ id: 'oc-r', numero: `OC-${ANO}-007`, status: 'rascunho', itens: [{ id: 'oci-r', pecaId: PECA_A, quantidade: 2, valorUnit: 1, origens: [{ id: 'o-r', solicitacaoCompraItemId: 'sci-m', quantidade: 2 }] }] });

    const erro = await b.servico.cancelarSolicitacao(ato()).catch((e: unknown) => e);

    expect(erro).toBeInstanceOf(ConflictException);
    expect((erro as Error).message).toContain(`OC-${ANO}-007, OC-${ANO}-009`);
    expect(b.banco.solicitacao('sc-m')).toMatchObject({ status: 'em_cotacao', canceladaEm: null });
    expect(b.banco.itemDeSolicitacao('sci-m')?.status).toBe('aberta');
  });

  it('cancelar com origem só em OC cancelada ou encerrada sem nada recebido: grava cancelada, motivo, autor e cancela os itens abertos', async () => {
    const b = montarBancoFalso();
    b.plantarSolicitacao({
      id: 'sc-m', numero: `SC-${ANO}-010`, status: 'em_cotacao',
      itens: [
        { id: 'sci-m', pecaId: PECA_A, quantidade: 10 },
        { id: 'sci-m2', pecaId: PECA_B, quantidade: 1, status: 'cancelada' },
      ],
    });
    b.plantarOrdem({ id: 'oc-c', numero: `OC-${ANO}-001`, status: 'cancelada', itens: [{ id: 'oci-c', pecaId: PECA_A, quantidade: 3, valorUnit: 1, origens: [{ id: 'o-c', solicitacaoCompraItemId: 'sci-m', quantidade: 3 }] }] });
    b.plantarOrdem({ id: 'oc-enc', numero: `OC-${ANO}-002`, status: 'encerrada', itens: [{ id: 'oci-enc', pecaId: PECA_A, quantidade: 3, valorUnit: 1, origens: [{ id: 'o-enc', solicitacaoCompraItemId: 'sci-m', quantidade: 3 }] }] });

    const resposta = await b.servico.cancelarSolicitacao(ato());

    expect(b.banco.solicitacao('sc-m')).toMatchObject({
      status: 'cancelada', canceladaPorCompanyUserId: COMPRADOR, motivoCancelamento: 'Compra feita pelo contrato anual',
      rejeitadaEm: null, motivoRejeicao: null,
    });
    expect(b.banco.solicitacao('sc-m')?.canceladaEm).toBeInstanceOf(Date);
    expect(b.banco.itemDeSolicitacao('sci-m')?.status).toBe('cancelada');
    expect(b.banco.itemDeSolicitacao('sci-m2')?.status).toBe('cancelada');
    expect(b.banco.auditoria()).toEqual([
      expect.objectContaining({ acao: 'solicitacao_compra.cancelar', alvoId: 'sc-m', motivo: 'Compra feita pelo contrato anual', atorId: COMPRADOR }),
    ]);
    expect(resposta).toMatchObject({ id: 'sc-m', status: 'cancelada' });
    expect(resposta.itens.every((i) => i.disponivelParaCotar === 0)).toBe(true);
  });

  it('rejeitar solicitação de estoque mínimo grava rejeitada com motivo e autor', async () => {
    const b = montarBancoFalso();
    b.plantarSolicitacao({ id: 'sc-m', numero: `SC-${ANO}-011`, origem: 'estoque_minimo', prioridade: 'reposicao', itens: [{ id: 'sci-m', pecaId: PECA_A, quantidade: 6 }] });

    await b.servico.rejeitarSolicitacao(ato({ motivo: 'Estoque mínimo mal configurado' }));

    expect(b.banco.solicitacao('sc-m')).toMatchObject({
      status: 'rejeitada', rejeitadaPorCompanyUserId: COMPRADOR, motivoRejeicao: 'Estoque mínimo mal configurado', canceladaEm: null,
    });
    expect(b.banco.itemDeSolicitacao('sci-m')?.status).toBe('cancelada');
    expect(b.banco.auditoria()[0]).toMatchObject({ acao: 'solicitacao_compra.rejeitar' });
  });

  it('solicitação já aprovada não é rejeitada: 409', async () => {
    const b = montarBancoFalso();
    b.plantarSolicitacao({ id: 'sc-m', numero: `SC-${ANO}-012`, status: 'aprovada', itens: [{ id: 'sci-m', pecaId: PECA_A, quantidade: 1 }] });
    await expect(b.servico.rejeitarSolicitacao(ato())).rejects.toBeInstanceOf(ConflictException);
    expect(b.banco.solicitacao('sc-m')?.status).toBe('aprovada');
  });

  it('motivo vazio: 400 antes de abrir transação', async () => {
    const b = montarBancoFalso();
    await expect(b.servico.cancelarSolicitacao(ato({ motivo: '   ' }))).rejects.toBeInstanceOf(BadRequestException);
    expect(b.prisma.$transaction).not.toHaveBeenCalled();
  });

  it('trava as linhas de item (por id) antes do cabeçalho — a ordem do cancelamento da requisição', async () => {
    const b = montarBancoFalso();
    b.plantarSolicitacao({ id: 'sc-m', numero: `SC-${ANO}-013`, itens: [{ id: 'sci-b', pecaId: PECA_B, quantidade: 1 }, { id: 'sci-a', pecaId: PECA_A, quantidade: 1 }] });

    await b.servico.cancelarSolicitacao(ato());

    expect(b.travas).toEqual(['solicitacao_compra_itens:sci-a', 'solicitacao_compra_itens:sci-b', 'solicitacoes_compra:sc-m']);
  });

  it('solicitação de outra empresa: 404', async () => {
    const b = montarBancoFalso();
    b.plantarSolicitacao({ id: 'sc-m', numero: 'SC-X', companyId: OUTRA_EMPRESA, depositoId: DEPOSITO_DE_FORA, itens: [{ id: 'sci-m', pecaId: PECA_DE_FORA, quantidade: 1 }] });
    await expect(b.servico.cancelarSolicitacao(ato())).rejects.toBeInstanceOf(NotFoundException);
    expect(b.banco.solicitacao('sc-m')?.status).toBe('pendente');
  });
});
