import { novoCustoMedio, sinalDoTipo } from './movimento';

describe('sinalDoTipo', () => {
  it('entrada e devolução somam', () => {
    expect(sinalDoTipo('entrada')).toBe(1);
    expect(sinalDoTipo('devolucao')).toBe(1);
  });

  it('saída subtrai', () => {
    expect(sinalDoTipo('saida')).toBe(-1);
  });

  it('ajuste soma — o sinal do ajuste vem na quantidade, não no tipo', () => {
    // Ajuste de inventário corrige para cima e para baixo; quem decide a
    // direção é quem digita, e o tipo só diz o motivo.
    expect(sinalDoTipo('ajuste')).toBe(1);
  });
});

describe('novoCustoMedio', () => {
  it('primeira entrada define o custo', () => {
    expect(novoCustoMedio(0, 0, 10, 25)).toBe(25);
  });

  it('pondera pela quantidade, não pela média das médias', () => {
    // 10 a 20 + 30 a 40 = 400 + 1200 em 40 unidades = 40.
    // Média simples daria 30 e subvalorizaria o estoque em 25%.
    expect(novoCustoMedio(20, 10, 30, 40)).toBe(40);
  });

  it('entrada sem custo informado não estraga a média', () => {
    // Devolução de sobra entra sem nota: manter o custo é mais correto que
    // achatar a média para zero.
    expect(novoCustoMedio(30, 10, 5, null)).toBe(30);
  });

  it('saldo anterior negativo é tratado como zero', () => {
    expect(novoCustoMedio(10, -5, 10, 50)).toBe(50);
  });
});
