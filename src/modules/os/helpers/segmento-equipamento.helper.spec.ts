import {
  oficinaAtendeSegmento,
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

  it('oficina sem segmento cadastrado permanece elegível', () => {
    expect(oficinaAtendeSegmento([], 'Carro leve')).toBe(true);
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
