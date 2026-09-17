import {
  requisicaoEstaSeparada,
  statusDoItemAposSeparacao,
  temDivergencia,
  validarConferencia,
} from './separacao';

const item = (p: Partial<{ quantidadeReservada: number; status: string; impeditivo: boolean; divergencia: string | null }> = {}) => ({
  quantidadeReservada: 4,
  status: 'reservada',
  impeditivo: true,
  divergencia: null,
  ...p,
});

describe('validarConferencia', () => {
  it('separar exatamente o reservado é o caso normal', () => {
    expect(validarConferencia(item(), { quantidade: 4 })).toEqual({ ok: true, quantidade: 4 });
  });

  it('separar menos que o reservado é permitido — é o que gera divergência', () => {
    // Veio menos do que a prateleira prometia. Recusar aqui obrigaria o
    // almoxarife a mentir para conseguir registrar o que de fato aconteceu.
    expect(validarConferencia(item(), { quantidade: 3 })).toEqual({ ok: true, quantidade: 3 });
  });

  it('separar MAIS que o reservado é recusado', () => {
    // O CHECK `req_item_cascata_quantidades` recusaria no banco; recusar aqui
    // devolve mensagem em vez de 500.
    expect(validarConferencia(item(), { quantidade: 5 })).toEqual({
      ok: false,
      erro: 'Não dá para separar 5 de um item com 4 reservado.',
    });
  });

  it('quantidade negativa é recusada', () => {
    expect(validarConferencia(item(), { quantidade: -1 }).ok).toBe(false);
  });

  it('item faltante não pode ser separado', () => {
    // Não há o que conferir: a peça não foi reservada porque não existe.
    expect(validarConferencia(item({ status: 'faltante' }), { quantidade: 1 })).toEqual({
      ok: false,
      erro: 'Item ainda não reservado não pode ser separado.',
    });
  });

  it('item não vinculado não pode ser separado', () => {
    expect(validarConferencia(item({ status: 'nao_vinculado' }), { quantidade: 1 }).ok).toBe(false);
  });

  it('item esperando aprovação do equivalente não pode ser separado', () => {
    // Critério 11. Enquanto o mecânico da OS não disser que a peça de outra
    // marca serve naquela máquina, não há o que conferir: a troca ainda não
    // aconteceu, e o que está reservado (se algo está) é da peça original.
    expect(validarConferencia(item({ status: 'aguardando_equivalente' }), { quantidade: 1 })).toEqual({
      ok: false,
      erro: 'Item ainda não reservado não pode ser separado.',
    });
  });

  it('separar zero é permitido e é como se anula uma conferência', () => {
    expect(validarConferencia(item(), { quantidade: 0 })).toEqual({ ok: true, quantidade: 0 });
  });
});

describe('statusDoItemAposSeparacao', () => {
  it('conferido por inteiro vira separada', () => {
    expect(statusDoItemAposSeparacao(item(), { quantidade: 4 })).toBe('separada');
  });

  it('conferido em parte continua reservada', () => {
    // "Separada" quer dizer "está no kit, inteira". Parcial não libera nada.
    expect(statusDoItemAposSeparacao(item(), { quantidade: 3 })).toBe('reservada');
  });

  it('conferido zero volta a reservada', () => {
    expect(statusDoItemAposSeparacao(item({ status: 'separada' }), { quantidade: 0 })).toBe('reservada');
  });
});

describe('requisicaoEstaSeparada', () => {
  it('todos os impeditivos separados basta — o não-impeditivo não segura', () => {
    expect(requisicaoEstaSeparada([
      item({ status: 'separada' }),
      item({ status: 'reservada', impeditivo: false }),
    ])).toBe(true);
  });

  it('impeditivo ainda reservado não fecha o kit', () => {
    expect(requisicaoEstaSeparada([item({ status: 'reservada' })])).toBe(false);
  });

  it('impeditivo cancelado não segura', () => {
    expect(requisicaoEstaSeparada([
      item({ status: 'separada' }),
      item({ status: 'cancelada' }),
    ])).toBe(true);
  });

  it('impeditivo ENTREGUE numa rodada anterior conta como resolvido — senão o kit nunca mais fecha', () => {
    // Entrega parcial (o impeditivo foi levado, um item faltava), a compra
    // chega, o almoxarife confere a peça nova: o kit tem de fechar de novo.
    expect(requisicaoEstaSeparada([
      item({ status: 'entregue' }),
      item({ status: 'separada', impeditivo: false }),
    ])).toBe(true);
  });

  it('sem impeditivo, item entregue ao lado de item separado fecha o kit', () => {
    expect(requisicaoEstaSeparada([
      item({ status: 'entregue', impeditivo: false }),
      item({ status: 'separada', impeditivo: false }),
    ])).toBe(true);
  });

  it('entregue ao lado de impeditivo ainda reservado NÃO fecha o kit', () => {
    expect(requisicaoEstaSeparada([
      item({ status: 'entregue' }),
      item({ status: 'reservada' }),
    ])).toBe(false);
  });

  it('impeditivo esperando aprovação do equivalente NÃO fecha o kit', () => {
    // Critério 11: a proposta de troca é uma pendência viva, não um item
    // resolvido. Tratá-la como resolvida liberaria a OS com a peça que o
    // mecânico ainda não aceitou.
    expect(
      requisicaoEstaSeparada([
        item({ status: 'aguardando_equivalente', impeditivo: true }),
        item({ status: 'separada', impeditivo: true }),
      ]),
    ).toBe(false);
  });

  it('requisição sem item nenhum não está separada', () => {
    // Kit vazio não é kit pronto. A F1/F2 já garante que requisição sem item
    // não é criada, mas o dado pode chegar assim de um cancelamento parcial.
    expect(requisicaoEstaSeparada([])).toBe(false);
  });
});

describe('temDivergencia', () => {
  it('qualquer item com divergência marca a requisição', () => {
    expect(temDivergencia([item(), item({ divergencia: 'veio avariada' })])).toBe(true);
  });

  it('divergência vazia não conta', () => {
    // Campo limpo pela tela vem como string vazia, não como null.
    expect(temDivergencia([item({ divergencia: '  ' })])).toBe(false);
  });

  it('item cancelado com divergência não segura a liberação', () => {
    expect(temDivergencia([item({ status: 'cancelada', divergencia: 'errada' })])).toBe(false);
  });
});
