import {
  acaoPermitida,
  cobertura,
  compararLugarNaFila,
  distribuirRecebimento,
  exigeAprovacao,
  faltaDoItem,
  podeAprovarOrdemDeCompra,
  situacaoDoItemDeSolicitacao,
  statusDaOrdemAposRecebimento,
  statusDaSolicitacao,
  statusMateriaisComCompra,
  valorTotalDaOrdem,
} from './compras';

const origem = (statusOrdemCompra: string, quantidade: number, quantidadeRecebida = 0) => ({
  statusOrdemCompra, quantidade, quantidadeRecebida,
});

describe('faltaDoItem', () => {
  it('faltante parcial: falta é solicitada menos reservada', () => {
    expect(faltaDoItem({ status: 'faltante', quantidadeSolicitada: 5, quantidadeReservada: 3 })).toBe(2);
  });

  it('item que não é faltante não tem falta, mesmo com reserva menor que o pedido', () => {
    // `reservada` conferida em parte, `separada`, `entregue`: a compra não cobre.
    expect(faltaDoItem({ status: 'reservada', quantidadeSolicitada: 5, quantidadeReservada: 3 })).toBe(0);
  });

  it('conta em milésimos: 0,3 − 0,1 é 0,2, não 0,19999999999999998', () => {
    expect(faltaDoItem({ status: 'faltante', quantidadeSolicitada: 0.3, quantidadeReservada: 0.1 })).toBe(0.2);
  });
});

describe('cobertura', () => {
  it('rascunho e aguardando aprovação são cotação, não compra', () => {
    expect(cobertura([origem('rascunho', 2), origem('aguardando_aprovacao', 3)])).toEqual({
      emCotacao: 5, aCaminho: 0, recebido: 0,
    });
  });

  it('emitida conta o que ainda falta chegar; o recebido conta à parte', () => {
    expect(cobertura([origem('recebida_parcial', 5, 2)])).toEqual({ emCotacao: 0, aCaminho: 3, recebido: 2 });
  });

  it('encerrada conta só o que recebeu — o resto não vem', () => {
    expect(cobertura([origem('encerrada', 5, 2)])).toEqual({ emCotacao: 0, aCaminho: 0, recebido: 2 });
  });

  it('cancelada não conta nada', () => {
    expect(cobertura([origem('cancelada', 5)])).toEqual({ emCotacao: 0, aCaminho: 0, recebido: 0 });
  });
});

describe('statusMateriaisComCompra', () => {
  const coberta = (aCaminho: number, recebido = 0) => ({ emCotacao: 0, aCaminho, recebido });

  it('falta sem OC emitida cobrindo continua aguardando compra — cotação não conta', () => {
    expect(statusMateriaisComCompra('aguardando_compra', [
      { falta: 2, cobertura: { emCotacao: 2, aCaminho: 0, recebido: 0 } },
    ])).toBe('aguardando_compra');
  });

  it('toda falta coberta por OC emitida, nada recebido: compra em andamento', () => {
    expect(statusMateriaisComCompra('aguardando_compra', [{ falta: 2, cobertura: coberta(2) }]))
      .toBe('compra_em_andamento');
  });

  it('toda falta coberta e alguma já recebeu parte: recebimento parcial', () => {
    expect(statusMateriaisComCompra('aguardando_compra', [
      { falta: 1, cobertura: coberta(1, 1) },
      { falta: 3, cobertura: coberta(3) },
    ])).toBe('recebimento_parcial');
  });

  it('uma falta descoberta segura a OS em aguardando compra, mesmo com outra recebendo', () => {
    expect(statusMateriaisComCompra('aguardando_compra', [
      { falta: 1, cobertura: coberta(1, 1) },
      { falta: 3, cobertura: coberta(2) },
    ])).toBe('aguardando_compra');
  });

  it('não mexe em estado que não é de falta', () => {
    expect(statusMateriaisComCompra('aguardando_separacao', [{ falta: 2, cobertura: coberta(2) }]))
      .toBe('aguardando_separacao');
    expect(statusMateriaisComCompra('em_analise_materiais', [{ falta: 2, cobertura: coberta(2) }]))
      .toBe('em_analise_materiais');
  });

  it('cobertura igual à falta cobre — em milésimos, 0,1 + 0,2 cobre 0,3', () => {
    expect(statusMateriaisComCompra('aguardando_compra', [
      { falta: 0.3, cobertura: cobertura([origem('emitida', 0.1), origem('emitida', 0.2)]) },
    ])).toBe('compra_em_andamento');
  });
});

describe('valorTotalDaOrdem', () => {
  it('soma quantidade × valor unitário e arredonda nos centavos', () => {
    // 3 × 10,005 = 30,015 → 30,02 (meio para cima); 0,5 × 1,0001 = 0,50005 → 0,50.
    expect(valorTotalDaOrdem([{ quantidade: 3, valorUnit: 10.005 }])).toBe(30.02);
    expect(valorTotalDaOrdem([{ quantidade: 0.5, valorUnit: 1.0001 }])).toBe(0.5);
  });

  it('valor alto sem perder precisão', () => {
    expect(valorTotalDaOrdem([{ quantidade: 1000, valorUnit: 99999.9999 }])).toBe(99999999.9);
  });
});

describe('exigeAprovacao', () => {
  it('empresa sem limite configurado: toda ordem pede aprovação', () => {
    expect(exigeAprovacao(0.01, null)).toBe(true);
  });

  it('só o que passa do limite pede — igual ao limite não pede', () => {
    expect(exigeAprovacao(1000, 1000)).toBe(false);
    expect(exigeAprovacao(1000.01, 1000)).toBe(true);
  });
});

describe('podeAprovarOrdemDeCompra', () => {
  it('OWNER e ADMIN aprovam', () => {
    expect(podeAprovarOrdemDeCompra({ role: 'OWNER', companyUserId: 'u1' }, null)).toBe(true);
    expect(podeAprovarOrdemDeCompra({ role: 'ADMIN', companyUserId: 'u1' }, 'g1')).toBe(true);
  });

  it('o gestor master configurado aprova, mesmo sendo MEMBER', () => {
    expect(podeAprovarOrdemDeCompra({ role: 'MEMBER', companyUserId: 'g1' }, 'g1')).toBe(true);
  });

  it('MEMBER que não é o gestor master não aprova — nem com gestor master vazio', () => {
    expect(podeAprovarOrdemDeCompra({ role: 'MEMBER', companyUserId: 'u1' }, 'g1')).toBe(false);
    expect(podeAprovarOrdemDeCompra({ role: 'MEMBER', companyUserId: 'u1' }, null)).toBe(false);
  });
});

describe('acaoPermitida', () => {
  it('só se edita e confirma rascunho', () => {
    expect(acaoPermitida('rascunho', 'editar')).toBe(true);
    expect(acaoPermitida('aguardando_aprovacao', 'editar')).toBe(false);
    expect(acaoPermitida('emitida', 'confirmar')).toBe(false);
  });

  it('cancelar não alcança OC que recebeu peça; encerrar só OC que recebeu parte', () => {
    expect(acaoPermitida('enviada', 'cancelar')).toBe(true);
    expect(acaoPermitida('recebida_parcial', 'cancelar')).toBe(false);
    expect(acaoPermitida('recebida_parcial', 'encerrar')).toBe(true);
    expect(acaoPermitida('emitida', 'encerrar')).toBe(false);
  });

  it('recebe OC emitida, enviada ou recebida em parte — nunca rascunho nem aguardando aprovação', () => {
    expect(acaoPermitida('emitida', 'receber')).toBe(true);
    expect(acaoPermitida('recebida_parcial', 'receber')).toBe(true);
    expect(acaoPermitida('aguardando_aprovacao', 'receber')).toBe(false);
    expect(acaoPermitida('recebida', 'receber')).toBe(false);
  });
});

describe('statusDaOrdemAposRecebimento', () => {
  it('tudo chegou: recebida; algo falta: recebida parcial', () => {
    expect(statusDaOrdemAposRecebimento([{ quantidade: 5, quantidadeRecebida: 5 }])).toBe('recebida');
    expect(statusDaOrdemAposRecebimento([
      { quantidade: 5, quantidadeRecebida: 5 }, { quantidade: 2, quantidadeRecebida: 1 },
    ])).toBe('recebida_parcial');
  });
});

describe('situacaoDoItemDeSolicitacao', () => {
  it('OC encerrada devolve para cotação o que não chegou', () => {
    expect(situacaoDoItemDeSolicitacao(5, [origem('encerrada', 5, 2)])).toEqual({
      comprado: 2, emCotacao: 0, recebido: 2, disponivelParaCotar: 3,
    });
  });

  it('cotado e comprado não ficam disponíveis para outra OC', () => {
    expect(situacaoDoItemDeSolicitacao(10, [origem('rascunho', 3), origem('emitida', 4)])).toEqual({
      comprado: 4, emCotacao: 3, recebido: 0, disponivelParaCotar: 3,
    });
  });

  it('OC cancelada libera tudo para cotar de novo', () => {
    expect(situacaoDoItemDeSolicitacao(5, [origem('cancelada', 5)]).disponivelParaCotar).toBe(5);
  });
});

describe('statusDaSolicitacao', () => {
  it('rejeitada e cancelada são atos, não se derivam', () => {
    expect(statusDaSolicitacao('cancelada', [{ status: 'aberta', quantidade: 1, comprado: 1, emCotacao: 0 }]))
      .toBe('cancelada');
  });

  it('nada andou: pendente; algo cotado: em cotação; tudo comprado: aprovada', () => {
    const item = (comprado: number, emCotacao: number) => ({ status: 'aberta', quantidade: 5, comprado, emCotacao });
    expect(statusDaSolicitacao('pendente', [item(0, 0)])).toBe('pendente');
    expect(statusDaSolicitacao('pendente', [item(0, 2)])).toBe('em_cotacao');
    expect(statusDaSolicitacao('em_cotacao', [item(5, 0)])).toBe('aprovada');
  });

  it('OC encerrada que devolveu parte faz a solicitação voltar a em cotação', () => {
    expect(statusDaSolicitacao('aprovada', [{ status: 'aberta', quantidade: 5, comprado: 2, emCotacao: 0 }]))
      .toBe('em_cotacao');
  });

  it('item cancelado não segura nem empurra o cabeçalho', () => {
    expect(statusDaSolicitacao('pendente', [
      { status: 'cancelada', quantidade: 5, comprado: 0, emCotacao: 0 },
      { status: 'aberta', quantidade: 1, comprado: 1, emCotacao: 0 },
    ])).toBe('aprovada');
  });
});

describe('compararLugarNaFila (§8)', () => {
  const lugar = (id: string, prioridade: string, dataNecessidade: string | null, pedidoEm: string) => ({
    id, prioridade,
    dataNecessidade: dataNecessidade ? new Date(dataNecessidade) : null,
    pedidoEm: new Date(pedidoEm),
  });

  it('prioridade primeiro, depois data da necessidade (sem data vai por último), depois quem pediu antes', () => {
    const fila = [
      lugar('d', 'normal', '2026-09-10', '2026-09-01'),
      lugar('c', 'alta', null, '2026-09-01'),
      lugar('b', 'alta', '2026-09-20', '2026-09-05'),
      lugar('a', 'alta', '2026-09-20', '2026-09-02'),
      lugar('e', 'critica', null, '2026-09-09'),
    ].sort(compararLugarNaFila);
    expect(fila.map((l) => l.id)).toEqual(['e', 'a', 'b', 'c', 'd']);
  });
});

describe('distribuirRecebimento', () => {
  const dia = (d: string) => new Date(`2026-09-${d}T12:00:00Z`);

  it('reserva para a falta de quem pediu, e o que passa da falta fica livre', () => {
    const r = distribuirRecebimento({
      quantidade: 5,
      origens: [{ id: 'o1', prioridade: 'alta', dataNecessidade: null, pedidoEm: dia('01'), pendente: 5, requisicaoItemId: 'ri1' }],
      faltaAtual: { ri1: 2 },
      outrasFaltas: [],
    });
    expect(r).toEqual({
      porOrigem: [{ origemId: 'o1', recebido: 5 }],
      reservas: [{ requisicaoItemId: 'ri1', quantidade: 2 }],
      livre: 3,
    });
  });

  it('entre origens, a crítica recebe antes da normal — mesmo pedida depois', () => {
    const r = distribuirRecebimento({
      quantidade: 3,
      origens: [
        { id: 'normal', prioridade: 'normal', dataNecessidade: null, pedidoEm: dia('01'), pendente: 3, requisicaoItemId: 'riN' },
        { id: 'critica', prioridade: 'critica', dataNecessidade: null, pedidoEm: dia('05'), pendente: 3, requisicaoItemId: 'riC' },
      ],
      faltaAtual: { riN: 3, riC: 3 },
      outrasFaltas: [],
    });
    expect(r.porOrigem).toEqual([{ origemId: 'critica', recebido: 3 }]);
    expect(r.reservas).toEqual([{ requisicaoItemId: 'riC', quantidade: 3 }]);
    expect(r.livre).toBe(0);
  });

  it('quem pediu, depois quem precisa: a sobra da reposição atende a falta de outra OS', () => {
    const r = distribuirRecebimento({
      quantidade: 10,
      origens: [{ id: 'repo', prioridade: 'reposicao', dataNecessidade: null, pedidoEm: dia('01'), pendente: 10, requisicaoItemId: null }],
      faltaAtual: { outra: 4 },
      outrasFaltas: [{ id: 'outra', prioridade: 'alta', dataNecessidade: null, pedidoEm: dia('03'), requisicaoItemId: 'outra' }],
    });
    expect(r.reservas).toEqual([{ requisicaoItemId: 'outra', quantidade: 4 }]);
    expect(r.livre).toBe(6);
  });

  it('a falta que a fase 1 já cobriu não é servida de novo na fase 2', () => {
    const r = distribuirRecebimento({
      quantidade: 5,
      origens: [{ id: 'o1', prioridade: 'alta', dataNecessidade: null, pedidoEm: dia('01'), pendente: 5, requisicaoItemId: 'ri1' }],
      faltaAtual: { ri1: 2 },
      outrasFaltas: [{ id: 'ri1', prioridade: 'alta', dataNecessidade: null, pedidoEm: dia('01'), requisicaoItemId: 'ri1' }],
    });
    expect(r.reservas).toEqual([{ requisicaoItemId: 'ri1', quantidade: 2 }]);
    expect(r.livre).toBe(3);
  });

  it('falta zerada (requisição cancelada, já coberta) não reserva — a peça fica livre', () => {
    const r = distribuirRecebimento({
      quantidade: 2,
      origens: [{ id: 'o1', prioridade: 'alta', dataNecessidade: null, pedidoEm: dia('01'), pendente: 2, requisicaoItemId: 'ri1' }],
      faltaAtual: {},
      outrasFaltas: [],
    });
    expect(r.porOrigem).toEqual([{ origemId: 'o1', recebido: 2 }]);
    expect(r.reservas).toEqual([]);
    expect(r.livre).toBe(2);
  });

  it('receber mais do que o pendente das origens é erro de quem chamou', () => {
    expect(() => distribuirRecebimento({
      quantidade: 6,
      origens: [{ id: 'o1', prioridade: 'alta', dataNecessidade: null, pedidoEm: dia('01'), pendente: 5, requisicaoItemId: null }],
      faltaAtual: {},
      outrasFaltas: [],
    })).toThrow(RangeError);
  });

  it('conta em milésimos: 0,1 + 0,2 recebidos cobrem uma falta de 0,3', () => {
    const r = distribuirRecebimento({
      quantidade: 0.3,
      origens: [
        { id: 'o1', prioridade: 'alta', dataNecessidade: null, pedidoEm: dia('01'), pendente: 0.1, requisicaoItemId: 'ri1' },
        { id: 'o2', prioridade: 'alta', dataNecessidade: null, pedidoEm: dia('02'), pendente: 0.2, requisicaoItemId: 'ri1' },
      ],
      faltaAtual: { ri1: 0.3 },
      outrasFaltas: [],
    });
    expect(r.reservas).toEqual([{ requisicaoItemId: 'ri1', quantidade: 0.3 }]);
    expect(r.livre).toBe(0);
  });
});
