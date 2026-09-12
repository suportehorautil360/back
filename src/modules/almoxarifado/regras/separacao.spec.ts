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
