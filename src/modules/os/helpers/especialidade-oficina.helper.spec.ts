import {
  especialidadeFromOficinaDoc,
  linhaAtuacaoParaEspecialidade,
} from './especialidade-oficina.helper';
import { mapOficinaCredenciadaDoc } from './oficinas-credenciadas.helper';

describe('especialidade-oficina.helper', () => {
  it('converte Linha Amarela em Amarela', () => {
    expect(linhaAtuacaoParaEspecialidade('Linha Amarela')).toBe('Amarela');
  });

  it('prioriza especialidade explícita', () => {
    expect(
      especialidadeFromOficinaDoc({
        especialidade: 'Pesados',
        linhasAtuacao: ['Linha Amarela'],
      }),
    ).toBe('Pesados');
  });

  it('usa primeira linha de atuação', () => {
    expect(
      especialidadeFromOficinaDoc({
        linhasAtuacao: ['Linha Amarela', 'Pesados'],
      }),
    ).toBe('Amarela');
  });
});

describe('oficinas-credenciadas.helper', () => {
  it('ignora oficina sem prefeituraId', () => {
    expect(
      mapOficinaCredenciadaDoc('id1', {
        status: 'Ativa',
        nome: 'Oficina X',
        especialidade: 'Amarela',
      }),
    ).toBeNull();
  });

  it('mapeia oficina credenciada ativa', () => {
    expect(
      mapOficinaCredenciadaDoc('id1', {
        prefeituraId: 'pref-1',
        status: 'Ativa',
        nome: 'Oficina X',
        linhasAtuacao: ['Linha Amarela'],
      }),
    ).toEqual({
      id: 'id1',
      nome: 'Oficina X',
      especialidade: 'Amarela',
    });
  });

  it('ignora oficina suspensa', () => {
    expect(
      mapOficinaCredenciadaDoc('id1', {
        prefeituraId: 'pref-1',
        status: 'Suspensa',
        nome: 'Oficina X',
        especialidade: 'Amarela',
      }),
    ).toBeNull();
  });
});
