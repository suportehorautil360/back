import { BadRequestException } from '@nestjs/common';
import { validarMatrizPreventiva } from './validar-matriz.helper';

describe('validarMatrizPreventiva', () => {
  const matrizValida = {
    categorias: [
      {
        id: 'cat-fluidos',
        nome: 'Fluidos',
        ciclos: [{ id: 'c1', horas: 250, km: 10000, titulo: 'Ciclo 1' }],
        linhas: [
          {
            id: 'l1',
            item: 'Óleo',
            especificacao: 'SAE',
            acoes: { c1: 'trocar' },
          },
        ],
      },
    ],
  };

  it('aceita plano com categorias→matriz', () => {
    expect(validarMatrizPreventiva(matrizValida)).toEqual(matrizValida);
  });

  it('rejeita sem categorias', () => {
    expect(() => validarMatrizPreventiva({ categorias: [] })).toThrow(
      BadRequestException,
    );
  });

  it('rejeita categoria sem ciclos', () => {
    expect(() =>
      validarMatrizPreventiva({
        categorias: [
          {
            id: 'cat-1',
            nome: 'X',
            ciclos: [],
            linhas: [],
          },
        ],
      }),
    ).toThrow(BadRequestException);
  });

  it('rejeita ação em ciclo inexistente', () => {
    expect(() =>
      validarMatrizPreventiva({
        categorias: [
          {
            ...matrizValida.categorias[0],
            linhas: [
              {
                id: 'l1',
                item: 'Óleo',
                especificacao: 'SAE',
                acoes: { c2: 'trocar' },
              },
            ],
          },
        ],
      }),
    ).toThrow(BadRequestException);
  });

  it('rejeita ação inválida', () => {
    expect(() =>
      validarMatrizPreventiva({
        categorias: [
          {
            ...matrizValida.categorias[0],
            linhas: [
              {
                id: 'l1',
                item: 'Óleo',
                especificacao: 'SAE',
                acoes: { c1: 'invalida' },
              },
            ],
          },
        ],
      }),
    ).toThrow(BadRequestException);
  });
});
