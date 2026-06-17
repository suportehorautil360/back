import { BadRequestException } from '@nestjs/common';
import { validarMatrizPreventiva } from './validar-matriz.helper';

describe('validarMatrizPreventiva', () => {
  const matrizValida = {
    ciclos: [{ id: 'c1', horas: 250, km: 10000, titulo: 'Ciclo 1' }],
    linhas: [
      {
        id: 'l1',
        categoria: 'Fluidos',
        item: 'Óleo',
        especificacao: 'SAE',
        acoes: { c1: 'trocar' },
      },
    ],
  };

  it('aceita matriz válida', () => {
    expect(validarMatrizPreventiva(matrizValida)).toEqual(matrizValida);
  });

  it('rejeita sem ciclos', () => {
    expect(() =>
      validarMatrizPreventiva({ ciclos: [], linhas: matrizValida.linhas }),
    ).toThrow(BadRequestException);
  });

  it('rejeita ação em ciclo inexistente', () => {
    expect(() =>
      validarMatrizPreventiva({
        ciclos: matrizValida.ciclos,
        linhas: [
          {
            ...matrizValida.linhas[0],
            acoes: { c2: 'trocar' },
          },
        ],
      }),
    ).toThrow(BadRequestException);
  });

  it('rejeita ação inválida', () => {
    expect(() =>
      validarMatrizPreventiva({
        ciclos: matrizValida.ciclos,
        linhas: [
          {
            ...matrizValida.linhas[0],
            acoes: { c1: 'invalida' },
          },
        ],
      }),
    ).toThrow(BadRequestException);
  });
});
