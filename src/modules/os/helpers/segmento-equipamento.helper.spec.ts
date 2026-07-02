import {
  inferLinhaFromTipo,
  oficinaAtendeSegmento,
  resolveLinhaEquipamento,
  resolveSegmentoEquipamento,
} from './segmento-equipamento.helper';

describe('segmento-equipamento.helper', () => {
  it('identifica carro leve', () => {
    expect(
      resolveSegmentoEquipamento({ linha: 'Linha Leve', tipo: 'Fiat Uno' }),
    ).toBe('Carro leve');
  });

  it('identifica máquinas linha amarela', () => {
    expect(
      resolveSegmentoEquipamento({
        linha: 'Linha Amarela',
        tipo: 'Escavadeira',
      }),
    ).toBe('Máquinas linha amarela');
  });

  it('identifica tratores linha verde', () => {
    expect(
      resolveSegmentoEquipamento({ linha: 'Linha Verde', tipo: 'Trator' }),
    ).toBe('Tratores linha verde');
  });

  it('identifica caminhão linha branca', () => {
    expect(
      resolveSegmentoEquipamento({ linha: 'Linha Branca', tipo: 'Caminhão' }),
    ).toBe('Caminhão linha branca');
  });

  it('resolve linha operacional a partir do tipo legado', () => {
    expect(
      resolveLinhaEquipamento({ tipo: 'Carro Leve', linha: 'Carro Leve' }),
    ).toBe('Linha Leve');
  });

  it('mantém linha cadastrada válida', () => {
    expect(
      resolveLinhaEquipamento({ tipo: 'Escavadeira', linha: 'Linha Amarela' }),
    ).toBe('Linha Amarela');
  });

  it('oficina sem segmento cadastrado não atende quando equipamento tem segmento', () => {
    expect(oficinaAtendeSegmento([], 'Carro leve')).toBe(false);
  });

  it('filtra oficina pelo segmento cadastrado', () => {
    expect(
      oficinaAtendeSegmento(['Carro leve'], 'Carro leve'),
    ).toBe(true);
    expect(
      oficinaAtendeSegmento(['Carro leve'], 'Máquinas linha amarela'),
    ).toBe(false);
  });
});
