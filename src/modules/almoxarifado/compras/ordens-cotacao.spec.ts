import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import {
  ANO,
  COMPRADOR,
  DEPOSITO,
  DEPOSITO_DE_FORA,
  DEPOSITO_FILIAL,
  DEPOSITO_INATIVO,
  EMPRESA,
  FORNECEDOR,
  FORNECEDOR_DE_FORA,
  FORNECEDOR_INATIVO,
  OFICINA,
  OUTRA_EMPRESA,
  PECA_A,
  PECA_B,
  PECA_C,
  PECA_DE_FORA,
  montarBancoFalso,
} from './banco-falso.fake-spec';

describe('criarOrdem', () => {
  const pedido = (extra: object = {}) => ({
    companyId: EMPRESA, autorCompanyUserId: COMPRADOR, partnerId: FORNECEDOR, depositoId: DEPOSITO, ...extra,
  });

  it.each([
    ['uma OFICINA (não é FORNECEDOR)', OFICINA],
    ['fornecedor de outra empresa', FORNECEDOR_DE_FORA],
    ['fornecedor inativo', FORNECEDOR_INATIVO],
  ])('parceiro que é %s: 400, sem abrir transação e sem gravar', async (_rotulo, partnerId) => {
    const b = montarBancoFalso();
    await expect(b.servico.criarOrdem(pedido({ partnerId }))).rejects.toBeInstanceOf(BadRequestException);
    expect(b.prisma.$transaction).not.toHaveBeenCalled();
    expect(b.banco.tabelas().ordens).toEqual([]);
  });

  it.each([
    ['de outra empresa', DEPOSITO_DE_FORA],
    ['inativo', DEPOSITO_INATIVO],
  ])('depósito %s: 404 sem abrir transação', async (_rotulo, depositoId) => {
    const b = montarBancoFalso();
    await expect(b.servico.criarOrdem(pedido({ depositoId }))).rejects.toBeInstanceOf(NotFoundException);
    expect(b.prisma.$transaction).not.toHaveBeenCalled();
  });

  it('grava rascunho com quem criou, o número seguinte do ano e o rastro', async () => {
    const b = montarBancoFalso();
    b.plantarOrdem({ id: 'oc-1', numero: `OC-${ANO}-001` });
    b.plantarOrdem({ id: 'oc-2', numero: `OC-${ANO}-002` });
    b.plantarOrdem({ id: 'oc-fora', numero: `OC-${ANO}-040`, companyId: OUTRA_EMPRESA, partnerId: FORNECEDOR_DE_FORA, depositoId: DEPOSITO_DE_FORA });

    const r = await b.servico.criarOrdem(pedido({ condicaoPagamento: ' 30 dias ', previsaoEntrega: '2026-09-30', observacao: '' }));

    expect(r).toEqual({ id: expect.any(String), numero: `OC-${ANO}-003` });
    expect(b.banco.ordem(r.id)).toMatchObject({
      companyId: EMPRESA, status: 'rascunho', partnerId: FORNECEDOR, depositoId: DEPOSITO,
      criadaPorCompanyUserId: COMPRADOR, condicaoPagamento: '30 dias', observacao: null, valorTotal: 0,
    });
    expect(b.banco.ordem(r.id)?.previsaoEntrega).toEqual(new Date('2026-09-30'));
    expect(b.banco.auditoria()).toEqual([expect.objectContaining({ acao: 'ordem_compra.criar', alvoId: r.id, atorId: COMPRADOR })]);
  });
});

describe('editarOrdem', () => {
  const pedido = (extra: object = {}) => ({ companyId: EMPRESA, ordemCompraId: 'oc-1', autorCompanyUserId: COMPRADOR, ...extra });

  it('só rascunho: ordem emitida devolve 409 e não muda', async () => {
    const b = montarBancoFalso();
    b.plantarOrdem({ id: 'oc-1', numero: 'OC-1', status: 'emitida' });
    await expect(b.servico.editarOrdem(pedido({ condicaoPagamento: '28 dias' }))).rejects.toBeInstanceOf(ConflictException);
    expect(b.banco.ordem('oc-1')?.condicaoPagamento).toBeNull();
  });

  it('trocar para uma OFICINA: 400 sem abrir transação', async () => {
    const b = montarBancoFalso();
    b.plantarOrdem({ id: 'oc-1', numero: 'OC-1' });
    await expect(b.servico.editarOrdem(pedido({ partnerId: OFICINA }))).rejects.toBeInstanceOf(BadRequestException);
    expect(b.prisma.$transaction).not.toHaveBeenCalled();
  });

  it('grava só os campos enviados; null apaga', async () => {
    const b = montarBancoFalso();
    b.plantarOrdem({ id: 'oc-1', numero: 'OC-1' });
    b.banco.ordem('oc-1')!.observacao = 'ligar antes';

    const r = await b.servico.editarOrdem(pedido({ condicaoPagamento: '28/56', previsaoEntrega: '2026-10-05', observacao: null }));

    expect(b.banco.ordem('oc-1')).toMatchObject({ condicaoPagamento: '28/56', observacao: null, partnerId: FORNECEDOR });
    expect(b.banco.ordem('oc-1')?.previsaoEntrega).toEqual(new Date('2026-10-05'));
    expect(r).toMatchObject({ id: 'oc-1', condicaoPagamento: '28/56', observacao: null });
    expect(b.banco.auditoria()[0]).toMatchObject({ acao: 'ordem_compra.editar' });
  });

  it('corpo sem campo nenhum: 400', async () => {
    const b = montarBancoFalso();
    b.plantarOrdem({ id: 'oc-1', numero: 'OC-1' });
    await expect(b.servico.editarOrdem(pedido())).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('listarOrdens — status inválido', () => {
  it('400 SEM consultar o banco', async () => {
    const b = montarBancoFalso();
    await expect(b.servico.listarOrdens(EMPRESA, COMPRADOR, 'aprovada')).rejects.toBeInstanceOf(BadRequestException);
    expect(b.prisma.ordemCompra.findMany).not.toHaveBeenCalled();
  });
});

describe('substituirItens — a cotação', () => {
  /**
   * sc-1: PECA_A 5 (3 já numa OC emitida → 2 disponível) e PECA_B 10.
   * sc-2: PECA_A 3. sc-filial: PECA_A 4 no depósito da filial.
   * sc-fora: item de outra empresa. oc-r: o rascunho sendo cotado.
   */
  function cenario() {
    const b = montarBancoFalso();
    b.plantarSolicitacao({ id: 'sc-1', numero: `SC-${ANO}-001`, itens: [{ id: 'sci-1a', pecaId: PECA_A, quantidade: 5 }, { id: 'sci-1b', pecaId: PECA_B, quantidade: 10 }] });
    b.plantarSolicitacao({ id: 'sc-2', numero: `SC-${ANO}-002`, itens: [{ id: 'sci-2a', pecaId: PECA_A, quantidade: 3 }] });
    b.plantarSolicitacao({ id: 'sc-filial', numero: `SC-${ANO}-003`, depositoId: DEPOSITO_FILIAL, itens: [{ id: 'sci-filial', pecaId: PECA_A, quantidade: 4 }] });
    b.plantarSolicitacao({ id: 'sc-fora', numero: `SC-${ANO}-004`, companyId: OUTRA_EMPRESA, depositoId: DEPOSITO_DE_FORA, itens: [{ id: 'sci-fora', pecaId: PECA_DE_FORA, quantidade: 2 }] });
    b.plantarSolicitacao({ id: 'sc-canc', numero: `SC-${ANO}-005`, status: 'cancelada', itens: [{ id: 'sci-canc', pecaId: PECA_C, quantidade: 2, status: 'cancelada' }] });
    b.plantarOrdem({ id: 'oc-emitida', numero: `OC-${ANO}-001`, status: 'emitida', itens: [{ id: 'oci-e', pecaId: PECA_A, quantidade: 3, valorUnit: 10, origens: [{ id: 'o-e', solicitacaoCompraItemId: 'sci-1a', quantidade: 3 }] }] });
    b.plantarOrdem({ id: 'oc-r', numero: `OC-${ANO}-002`, status: 'rascunho' });
    return b;
  }

  const cotar = (itens: unknown, ordemCompraId = 'oc-r') => ({
    companyId: EMPRESA, ordemCompraId, autorCompanyUserId: COMPRADOR, itens: itens as never,
  });

  const corpoValido = () => [
    { pecaId: PECA_A, valorUnit: 12.5, origens: [{ solicitacaoCompraItemId: 'sci-1a', quantidade: 2 }, { solicitacaoCompraItemId: 'sci-2a', quantidade: 3 }] },
    { pecaId: PECA_B, valorUnit: 7.3333, origens: [{ solicitacaoCompraItemId: 'sci-1b', quantidade: 2 }] },
  ];

  it('acima do disponível (outra OC emitida já tem 3 de 5): 409 citando a SC, e nada é gravado', async () => {
    const b = cenario();
    const erro = await b.servico
      .substituirItens(cotar([{ pecaId: PECA_A, valorUnit: 10, origens: [{ solicitacaoCompraItemId: 'sci-1a', quantidade: 3 }] }]))
      .catch((e: unknown) => e);

    expect(erro).toBeInstanceOf(ConflictException);
    expect((erro as Error).message).toContain(`SC-${ANO}-001`);
    expect((erro as Error).message).toContain('2 disponível');
    expect(b.banco.itensDaOrdem('oc-r')).toEqual([]);
    expect(b.banco.solicitacao('sc-1')?.status).toBe('pendente');
  });

  it('grava uma linha por peça com a soma das origens, o valor total e o estado das SC tocadas', async () => {
    const b = cenario();

    const r = await b.servico.substituirItens(cotar(corpoValido()));

    const itens = b.banco.itensDaOrdem('oc-r');
    expect(itens.map((i) => ({ pecaId: i.pecaId, quantidade: i.quantidade, valorUnit: i.valorUnit }))).toEqual([
      { pecaId: PECA_A, quantidade: 5, valorUnit: 12.5 },
      { pecaId: PECA_B, quantidade: 2, valorUnit: 7.3333 },
    ]);
    expect(b.banco.origensDoItem(itens[0].id).map((o) => [o.solicitacaoCompraItemId, o.quantidade])).toEqual([
      ['sci-1a', 2], ['sci-2a', 3],
    ]);
    // 5 × 12,50 + 2 × 7,3333 = 62,50 + 14,6666 = 77,1666 → 77,17
    expect(b.banco.ordem('oc-r')?.valorTotal).toBe(77.17);
    expect(b.banco.solicitacao('sc-1')?.status).toBe('em_cotacao');
    expect(b.banco.solicitacao('sc-2')?.status).toBe('em_cotacao');
    expect(r).toMatchObject({ id: 'oc-r', status: 'rascunho', valorTotal: 77.17 });
    expect(b.banco.auditoria()).toEqual([expect.objectContaining({ acao: 'ordem_compra.cotar', alvoId: 'oc-r' })]);
    // Cotação não é compra: nada de saldo.
    expect(b.tx.$executeRaw).not.toHaveBeenCalled();
    expect(b.tx.pecaSaldo.upsert).not.toHaveBeenCalled();
  });

  it('salvar o MESMO rascunho de novo não recusa a si mesmo — as origens desta OC não contam como cotação alheia', async () => {
    const b = cenario();
    await b.servico.substituirItens(cotar(corpoValido()));

    await expect(b.servico.substituirItens(cotar(corpoValido()))).resolves.toMatchObject({ valorTotal: 77.17 });
    expect(b.banco.itensDaOrdem('oc-r')).toHaveLength(2);
  });

  it('a SC que sai da cotação volta a pendente; lista vazia limpa o rascunho', async () => {
    const b = cenario();
    await b.servico.substituirItens(cotar(corpoValido()));

    await b.servico.substituirItens(cotar([{ pecaId: PECA_B, valorUnit: 7, origens: [{ solicitacaoCompraItemId: 'sci-1b', quantidade: 1 }] }]));
    expect(b.banco.solicitacao('sc-2')?.status).toBe('pendente');
    expect(b.banco.ordem('oc-r')?.valorTotal).toBe(7);

    await b.servico.substituirItens(cotar([]));
    expect(b.banco.itensDaOrdem('oc-r')).toEqual([]);
    expect(b.banco.ordem('oc-r')?.valorTotal).toBe(0);
    // sc-1 continua em cotação: a OC emitida ainda tem 3 do item dela.
    expect(b.banco.solicitacao('sc-1')?.status).toBe('em_cotacao');
  });

  it('item de SC de OUTRO depósito: 400, nada gravado', async () => {
    const b = cenario();
    const erro = await b.servico
      .substituirItens(cotar([{ pecaId: PECA_A, valorUnit: 1, origens: [{ solicitacaoCompraItemId: 'sci-filial', quantidade: 1 }] }]))
      .catch((e: unknown) => e);
    expect(erro).toBeInstanceOf(BadRequestException);
    expect((erro as Error).message).toContain('outro depósito');
    expect(b.banco.itensDaOrdem('oc-r')).toEqual([]);
  });

  it('item de SC de outra peça: 400', async () => {
    const b = cenario();
    await expect(
      b.servico.substituirItens(cotar([{ pecaId: PECA_B, valorUnit: 1, origens: [{ solicitacaoCompraItemId: 'sci-1a', quantidade: 1 }] }])),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('item de SC de outra empresa: 400 "não encontrado", sem travar nada dela', async () => {
    const b = cenario();
    await expect(
      b.servico.substituirItens(cotar([{ pecaId: PECA_DE_FORA, valorUnit: 1, origens: [{ solicitacaoCompraItemId: 'sci-fora', quantidade: 1 }] }])),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(b.travas).toEqual(['ordens_compra:oc-r']);
  });

  it('item de SC cancelada: 409', async () => {
    const b = cenario();
    await expect(
      b.servico.substituirItens(cotar([{ pecaId: PECA_C, valorUnit: 1, origens: [{ solicitacaoCompraItemId: 'sci-canc', quantidade: 1 }] }])),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('só rascunho: ordem aguardando aprovação devolve 409', async () => {
    const b = cenario();
    b.plantarOrdem({ id: 'oc-ag', numero: `OC-${ANO}-003`, status: 'aguardando_aprovacao' });
    await expect(b.servico.substituirItens(cotar(corpoValido(), 'oc-ag'))).rejects.toBeInstanceOf(ConflictException);
  });

  it('peça repetida ou item de SC repetido no corpo: 400 antes de abrir transação', async () => {
    const b = cenario();
    await expect(
      b.servico.substituirItens(cotar([
        { pecaId: PECA_A, valorUnit: 1, origens: [{ solicitacaoCompraItemId: 'sci-1a', quantidade: 1 }] },
        { pecaId: PECA_A, valorUnit: 1, origens: [{ solicitacaoCompraItemId: 'sci-2a', quantidade: 1 }] },
      ])),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      b.servico.substituirItens(cotar([
        { pecaId: PECA_A, valorUnit: 1, origens: [{ solicitacaoCompraItemId: 'sci-1a', quantidade: 1 }, { solicitacaoCompraItemId: 'sci-1a', quantidade: 1 }] },
      ])),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(b.prisma.$transaction).not.toHaveBeenCalled();
  });

  it('trava: OC, depois as linhas de SC que entram, depois os cabeçalhos — e nem requisição nem saldo', async () => {
    const b = cenario();
    await b.servico.substituirItens(cotar(corpoValido()));
    expect(b.travas).toEqual([
      'ordens_compra:oc-r',
      'solicitacao_compra_itens:sci-1a',
      'solicitacao_compra_itens:sci-1b',
      'solicitacao_compra_itens:sci-2a',
      'solicitacoes_compra:sc-1',
      'solicitacoes_compra:sc-2',
    ]);
  });
});
