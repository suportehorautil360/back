import {
  oficinaAtendeLinha,
  oficinaAtendeSegmentoEquipamento,
  segmentosEfetivosOficina,
} from './direcionamento-oficina.helper';

describe('direcionamento-oficina.helper', () => {
  it('prioriza segmentos cadastrados', () => {
    expect(
      segmentosEfetivosOficina(['Carro leve'], ['Linha Amarela']),
    ).toEqual(['Carro leve']);
  });

  it('infere segmentos legados a partir de linhas quando segmentos vazio', () => {
    expect(
      segmentosEfetivosOficina([], ['Linha Leve']),
    ).toEqual(['Carro leve']);
  });

  it('aceita linha derivada dos segmentos de equipamento', () => {
    expect(
      oficinaAtendeLinha(
        [],
        'Amarela',
        'Linha Amarela',
        ['Máquinas linha amarela'],
      ),
    ).toBe(true);
  });

  it('aceita qualquer linha de atuação legada marcada', () => {
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

  it('atende segmento cadastrado diretamente', () => {
    expect(
      oficinaAtendeSegmentoEquipamento(
        ['Carro leve'],
        [],
        'Carro leve',
      ),
    ).toBe(true);
  });
});
