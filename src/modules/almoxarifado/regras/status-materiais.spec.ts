import { podeLiberar, statusAposConsulta } from './status-materiais';

const item = (p: Partial<{ impeditivo: boolean; status: string }> = {}) => ({
  impeditivo: false,
  status: 'reservada',
  ...p,
});

describe('statusAposConsulta', () => {
  it('tudo reservado vai para aguardando separação', () => {
    expect(statusAposConsulta([item(), item()])).toBe('aguardando_separacao');
  });

  it('qualquer falta manda para aguardando compra', () => {
    expect(statusAposConsulta([item(), item({ status: 'faltante' })]))
      .toBe('aguardando_compra');
  });

  it('OS sem item de troca já nasce liberada', () => {
    // Ciclo só de inspeção não depende de peça nenhuma. Prendê-la em
    // "aguardando separação" criaria fila para um kit vazio.
    expect(statusAposConsulta([])).toBe('liberada_para_execucao');
  });
});

describe('podeLiberar', () => {
  it('libera quando todos os IMPEDITIVOS estão separados', () => {
    // O não-impeditivo ainda faltando não segura a máquina.
    expect(podeLiberar([
      item({ impeditivo: true, status: 'separada' }),
      item({ impeditivo: false, status: 'faltante' }),
    ])).toBe(true);
  });

  it('não libera com impeditivo apenas reservado', () => {
    // Reservado não é separado: receber não é conferir, e é o almoxarife que
    // diz que o kit está pronto.
    expect(podeLiberar([item({ impeditivo: true, status: 'reservada' })])).toBe(false);
  });

  it('item cancelado não segura a liberação', () => {
    expect(podeLiberar([
      item({ impeditivo: true, status: 'separada' }),
      item({ impeditivo: true, status: 'cancelada' }),
    ])).toBe(true);
  });

  it('impeditivo já entregue conta como atendido', () => {
    expect(podeLiberar([item({ impeditivo: true, status: 'entregue' })])).toBe(true);
  });
});
