import type { AbastecimentoConsumoInput } from '../consumo-custo.types';
import { buildVeiculoCard } from './consumo-custo.helper';

function abast(
  partial: Partial<AbastecimentoConsumoInput> & Pick<AbastecimentoConsumoInput, 'id' | 'createdAt' | 'liters'>,
): AbastecimentoConsumoInput {
  return {
    equipmentId: 'eq-1',
    plateOrChassis: 'ABC-1234',
    currentReading: null,
    measurementType: 'horimetro',
    total: null,
    pricePerLiter: null,
    postoId: null,
    ...partial,
  };
}

describe('consumo-custo.helper', () => {
  describe('buildVeiculoCard', () => {
    it('calcula médio L/h com leitura legada (campo leitura via service) e intervalo no período', () => {
      const abastecimentos: AbastecimentoConsumoInput[] = [
        abast({
          id: 'a1',
          createdAt: '2025-06-01T10:00:00.000Z',
          liters: 50,
          currentReading: 100,
        }),
        abast({
          id: 'a2',
          createdAt: '2025-06-15T12:00:00.000Z',
          liters: 60,
          currentReading: 110,
          total: 360,
        }),
      ];

      const card = buildVeiculoCard(
        'eq-1',
        abastecimentos,
        { descricao: 'Retroescavadeira' },
        '2025-06-01T00:00:00.000Z',
        '2025-06-30T23:59:59.999Z',
      );

      expect(card).not.toBeNull();
      expect(card!.consumoMedio.valor).toBeCloseTo(6, 2);
      expect(card!.custoMedio.valor).toBeCloseTo(36, 2);
      expect(card!.historicoIntervalos).toHaveLength(1);
    });

    it('usa abastecimento anterior ao período como baseline da leitura', () => {
      const abastecimentos: AbastecimentoConsumoInput[] = [
        abast({
          id: 'a0',
          createdAt: '2025-05-20T10:00:00.000Z',
          liters: 40,
          currentReading: 500,
        }),
        abast({
          id: 'a1',
          createdAt: '2025-06-10T10:00:00.000Z',
          liters: 30,
          currentReading: 510,
        }),
      ];

      const card = buildVeiculoCard(
        'eq-1',
        abastecimentos,
        {},
        '2025-06-01T00:00:00.000Z',
        '2025-06-30T23:59:59.999Z',
      );

      expect(card!.consumoMedio.valor).toBeCloseTo(3, 2);
    });

    it('não exibe média com um único abastecimento no período', () => {
      const abastecimentos: AbastecimentoConsumoInput[] = [
        abast({
          id: 'a1',
          createdAt: '2025-06-10T10:00:00.000Z',
          liters: 80,
          currentReading: 200,
        }),
      ];

      const card = buildVeiculoCard(
        'eq-1',
        abastecimentos,
        {},
        '2025-06-01T00:00:00.000Z',
        '2025-06-30T23:59:59.999Z',
      );

      expect(card!.consumoMedio.valor).toBeNull();
      expect(card!.totais.litros).toBe(80);
    });
  });
});
