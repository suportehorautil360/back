import {
  oficinaAtendeLinha,
  oficinaAtendeSegmentoEquipamento,
  segmentosEfetivosOficina,
} from './direcionamento-oficina.helper';

describe('direcionamento-oficina.helper', () => {
  it('infere segmento Carro leve a partir de Linha Leve', () => {
    expect(
      segmentosEfetivosOficina([], ['Linha Leve']),
    ).toEqual(['Carro leve']);
  });

  it('une segmentos cadastrados com inferidos das linhas', () => {
    expect(
      segmentosEfetivosOficina(['Caminhão linha branca'], ['Linha Leve']),
    ).toEqual(['Caminhão linha branca', 'Carro leve']);
  });

  it('aceita qualquer linha de atuação marcada, não só a primeira', () => {
    expect(
      oficinaAtendeLinha(
        ['Linha Branca', 'Linha Leve'],
        'Branca',
        'Linha Leve',
      ),
    ).toBe(true);
  });

  it('rejeita linha incompatível', () => {
    expect(
      oficinaAtendeLinha(['Linha Branca'], 'Branca', 'Linha Leve'),
    ).toBe(false);
  });

  it('atende segmento inferido pela linha leve', () => {
    expect(
      oficinaAtendeSegmentoEquipamento([], ['Linha Leve'], 'Carro leve'),
    ).toBe(true);
  });
});
