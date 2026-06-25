import { BadRequestException } from '@nestjs/common';
import {
  mapDtoItemsToFirestore,
  parseOrcamentoItemsFromDto,
} from './orcamento-items.helper';

describe('orcamento-items.helper', () => {
  it('preserva metadados dos itens', () => {
    const [item] = mapDtoItemsToFirestore([
      {
        description: 'Filtro de óleo',
        value: 120,
        category: 'part',
        code: 'FLT-01',
        brand: 'Mann',
        quantity: 2,
        unitValue: 60,
      },
    ]);

    expect(item).toMatchObject({
      descricao: 'Filtro de óleo',
      valor: 120,
      category: 'part',
      code: 'FLT-01',
      brand: 'Mann',
      quantity: 2,
      unitValue: 60,
    });
  });

  it('valida total do orçamento', () => {
    expect(() =>
      parseOrcamentoItemsFromDto([{ description: 'Item', value: 0 }]),
    ).toThrow(BadRequestException);
  });
});
