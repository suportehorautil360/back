import { BadRequestException } from '@nestjs/common';
import type { OrcamentoItemDto } from '../dto/create-orcamento.dto';
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
      codigo: 'FLT-01',
      brand: 'Mann',
      marca: 'Mann',
      quantity: 2,
      quantidade: 2,
      unitValue: 60,
      valorUnitario: 60,
    });
  });

  it('aceita campos em português no item', () => {
    const [item] = mapDtoItemsToFirestore([
      {
        descricao: 'Retentor',
        valor: 85,
        codigo: '992-0034',
        marca: 'Komatsu',
        quantidade: 1,
        valorUnitario: 85,
      } as unknown as OrcamentoItemDto,
    ]);

    expect(item).toMatchObject({
      descricao: 'Retentor',
      codigo: '992-0034',
      code: '992-0034',
      marca: 'Komatsu',
      brand: 'Komatsu',
    });
  });

  it('valida total do orçamento', () => {
    expect(() =>
      parseOrcamentoItemsFromDto([{ description: 'Item', value: 0 }]),
    ).toThrow(BadRequestException);
  });
});
