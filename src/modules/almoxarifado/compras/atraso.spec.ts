import { diasDeAtraso, estaAtrasada, ordensAtrasadas } from './atraso';

const HOJE = new Date('2026-09-16T10:00:00Z');
const oc = (p: Partial<{ status: string; previsaoEntrega: Date | null }> = {}) => ({
  id: 'oc-1',
  numero: 'OC-2026-001',
  status: 'enviada',
  previsaoEntrega: new Date('2026-09-10T00:00:00Z'),
  ...p,
});

describe('estaAtrasada', () => {
  it('ordem a caminho com previsão vencida está atrasada', () => {
    expect(estaAtrasada(oc(), HOJE)).toBe(true);
  });

  it('previsão de hoje ainda NÃO está atrasada — o dia não acabou', () => {
    expect(estaAtrasada(oc({ previsaoEntrega: new Date('2026-09-16T00:00:00Z') }), HOJE)).toBe(false);
  });

  it('sem previsão de entrega não há atraso a apontar', () => {
    // Cobrar prazo que ninguém combinou vira alerta que o comprador aprende
    // a ignorar — e aí ele ignora os de verdade também.
    expect(estaAtrasada(oc({ previsaoEntrega: null }), HOJE)).toBe(false);
  });

  it.each(['rascunho', 'aguardando_aprovacao', 'cancelada'])(
    'ordem %s não está atrasada: não foi para o fornecedor',
    (status) => {
      expect(estaAtrasada(oc({ status }), HOJE)).toBe(false);
    },
  );

  it.each(['recebida', 'encerrada'])('ordem %s não está atrasada: a peça já chegou', (status) => {
    expect(estaAtrasada(oc({ status }), HOJE)).toBe(false);
  });

  it.each(['emitida', 'enviada', 'recebida_parcial'])(
    'ordem %s conta como a caminho',
    (status) => {
      expect(estaAtrasada(oc({ status }), HOJE)).toBe(true);
    },
  );
});

describe('diasDeAtraso', () => {
  it('conta os dias inteiros entre a previsão e hoje', () => {
    expect(diasDeAtraso(new Date('2026-09-10T00:00:00Z'), HOJE)).toBe(6);
  });

  it('previsão no futuro devolve zero, nunca negativo', () => {
    expect(diasDeAtraso(new Date('2026-09-20T00:00:00Z'), HOJE)).toBe(0);
  });
});

describe('ordensAtrasadas', () => {
  it('filtra e ordena pela mais atrasada primeiro — é por onde o comprador começa', () => {
    const lista = [
      oc({ previsaoEntrega: new Date('2026-09-14T00:00:00Z') }),
      oc({ previsaoEntrega: new Date('2026-09-01T00:00:00Z') }),
      oc({ status: 'recebida' }),
      oc({ previsaoEntrega: null }),
    ];
    const r = ordensAtrasadas(lista, HOJE);
    expect(r.map((o) => o.diasDeAtraso)).toEqual([15, 2]);
  });
});
