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

  it('item não vinculado vai para EM ANÁLISE, não libera nem vira falta (achado Critical C3)', () => {
    // Antes desta correção, o chamador filtrava os itens `nao_vinculado`
    // (por não terem `pecaId`) antes de passar a lista para cá — e um plano
    // cuja ÚNICA linha de troca não resolveu peça caía em `itens: []` e
    // saía `liberada_para_execucao`, como se estivesse tudo certo. Esta
    // função agora recebe TODOS os itens e decide.
    expect(statusAposConsulta([item({ status: 'nao_vinculado' })]))
      .toBe('em_analise_materiais');
  });

  it('não vinculado pesa mais que faltante — não dá para comprar o que não se sabe o que é', () => {
    expect(statusAposConsulta([
      item({ status: 'nao_vinculado' }),
      item({ status: 'faltante' }),
    ])).toBe('em_analise_materiais');
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

  it('não vinculado impeditivo NUNCA conta como atendido (achado C3)', () => {
    expect(podeLiberar([item({ impeditivo: true, status: 'nao_vinculado' })])).toBe(false);
  });
});
