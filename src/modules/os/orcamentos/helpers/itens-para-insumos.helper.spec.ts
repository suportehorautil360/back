import {
  ehItemDePeca,
  itensParaInsumos,
  quantidadeEValor,
} from './itens-para-insumos.helper';

describe('ehItemDePeca', () => {
  it('só peça vira insumo', () => {
    // Mão de obra já é medida pelos apontamentos; deslocamento não é material
    // consumido. Somar os dois como insumo inflaria o custo de peças.
    expect(ehItemDePeca({ category: 'part' })).toBe(true);
    expect(ehItemDePeca({ category: 'service' })).toBe(false);
    expect(ehItemDePeca({ category: 'travel' })).toBe(false);
  });

  it('item sem categoria não vira insumo', () => {
    expect(ehItemDePeca({ descricao: 'Filtro' })).toBe(false);
  });
});

describe('quantidadeEValor', () => {
  it('usa quantidade e valor unitário quando o orçamento os informou', () => {
    expect(quantidadeEValor({ valor: 300, quantidade: 2, valorUnitario: 150 })).toEqual({
      quantidade: 2,
      valorUnit: 150,
    });
  });

  it('deriva o unitário do total quando só a quantidade veio', () => {
    expect(quantidadeEValor({ valor: 300, quantidade: 3 })).toEqual({
      quantidade: 3,
      valorUnit: 100,
    });
  });

  it('sem quantidade, a linha vale uma unidade do próprio total', () => {
    // O produto quantidade × unitário continua batendo com o valor que o
    // gestor viu e aprovou — é esse número que autoriza o gasto.
    expect(quantidadeEValor({ valor: 249.9 })).toEqual({ quantidade: 1, valorUnit: 249.9 });
  });

  it('aceita os nomes em inglês do item gravado', () => {
    expect(quantidadeEValor({ value: 80, quantity: 4, unitValue: 20 })).toEqual({
      quantidade: 4,
      valorUnit: 20,
    });
  });
});

describe('itensParaInsumos', () => {
  const itens = [
    {
      category: 'part',
      descricao: 'Filtro de óleo',
      description: 'Filtro de óleo',
      valor: 299.8,
      quantidade: 2,
      valorUnitario: 149.9,
      codigo: 'FO-1234',
      marca: 'Bosch',
    },
    { category: 'service', descricao: 'Mão de obra', valor: 400, hours: 4 },
    { category: 'travel', descricao: 'Deslocamento', valor: 120, km: 60 },
    { category: 'part', descricao: 'Mangueira', valor: 89.9 },
  ];

  it('converte só as peças, preservando código e marca', () => {
    const insumos = itensParaInsumos(itens, 'os-1');

    expect(insumos).toHaveLength(2);
    expect(insumos[0]).toMatchObject({
      serviceOrderId: 'os-1',
      descricao: 'Filtro de óleo',
      codigo: 'FO-1234',
      marca: 'Bosch',
    });
    expect(insumos[0].quantidade.toString()).toBe('2');
    expect(insumos[0].valorUnit.toString()).toBe('149.9');
  });

  it('continua a numeração dos insumos que a OS já tem', () => {
    // Sem isto, o lançado pelo mecânico e o vindo do orçamento disputariam a
    // mesma posição na lista.
    const insumos = itensParaInsumos(itens, 'os-1', 5);

    expect(insumos.map((i) => i.ordem)).toEqual([5, 6]);
  });

  it('preserva o total da linha quando não há quantidade', () => {
    const insumos = itensParaInsumos([itens[3]], 'os-1');

    expect(insumos[0].quantidade.toString()).toBe('1');
    expect(insumos[0].valorUnit.toString()).toBe('89.9');
  });

  it('descarta item sem descrição em vez de gravar insumo anônimo', () => {
    const insumos = itensParaInsumos([{ category: 'part', valor: 10 }], 'os-1');

    expect(insumos).toHaveLength(0);
  });

  it('tolera itens que não são array ou não são objeto', () => {
    // `Orcamento.itens` é Json: o banco não garante o formato.
    expect(itensParaInsumos(null, 'os-1')).toEqual([]);
    expect(itensParaInsumos('lixo', 'os-1')).toEqual([]);
    expect(itensParaInsumos([null, 'x', 42], 'os-1')).toEqual([]);
  });
});
