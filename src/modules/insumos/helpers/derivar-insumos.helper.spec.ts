import {
  derivarInsumosDeOrcamentoItem,
  isItemOrcamentoInsumo,
} from './derivar-insumos.helper';

describe('derivar-insumos.helper', () => {
  it('identifica item de orçamento como insumo', () => {
    expect(isItemOrcamentoInsumo({ category: 'part', code: '001' })).toBe(true);
    expect(isItemOrcamentoInsumo({ category: 'service' })).toBe(false);
    expect(
      isItemOrcamentoInsumo({
        description: 'Filtro de óleo',
        value: 120,
      }),
    ).toBe(true);
  });

  it('usa descrição como nome da peça e código separado', () => {
    const row = derivarInsumosDeOrcamentoItem(
      'ord-1',
      {
        category: 'part',
        code: '992-0034',
        description: 'Retentor hidráulico',
        quantity: 2,
        unitValue: 85,
        value: 170,
        brand: 'Komatsu',
      },
      0,
    );

    expect(row).toMatchObject({
      codigo: '992-0034',
      descricao: 'Retentor hidráulico',
      qtd: 2,
      vlrUnit: 85,
      total: 170,
      marca: 'Komatsu',
    });
  });

  it('aceita codigo PT do Firestore', () => {
    const row = derivarInsumosDeOrcamentoItem(
      'ord-1',
      {
        codigo: '00125',
        description: 'Anel O-Ring Viton',
        value: 30,
      },
      0,
    );

    expect(row?.codigo).toBe('00125');
  });

  it('aceita produto legado como codigo', () => {
    const row = derivarInsumosDeOrcamentoItem(
      'ord-1',
      {
        produto: '8842-A',
        descricao: 'Filtro hidráulico',
        valor: 180,
      },
      0,
    );

    expect(row?.codigo).toBe('8842-A');
  });

  it('sem código no orçamento deixa codigo vazio', () => {
    const row = derivarInsumosDeOrcamentoItem(
      'ord-1',
      {
        description: 'Anel O-Ring Viton',
        value: 30,
      },
      0,
    );

    expect(row).toMatchObject({
      codigo: '',
      descricao: 'Anel O-Ring Viton',
    });
  });
});
