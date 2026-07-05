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
    it('Caso 1 PDF: 45 L / 300 km com preço/l — consumo, gasto e custo', () => {
      const abastecimentos: AbastecimentoConsumoInput[] = [
        abast({
          id: 'a0',
          createdAt: '2025-06-01T08:00:00.000Z',
          liters: 0,
          currentReading: 0,
          measurementType: 'hodometro',
        }),
        abast({
          id: 'a1',
          createdAt: '2025-06-15T12:00:00.000Z',
          liters: 45,
          currentReading: 300,
          measurementType: 'hodometro',
          pricePerLiter: 5.99,
        }),
      ];

      const card = buildVeiculoCard(
        'eq-1',
        abastecimentos,
        { descricao: 'Frota', unidadeRevisao: 'km' },
        '2025-06-01T00:00:00.000Z',
        '2025-06-30T23:59:59.999Z',
      );

      expect(card).not.toBeNull();
      expect(card!.unidadeMedicao).toBe('km');
      expect(card!.consumoMedio.valor).toBeCloseTo(0.15, 4);
      expect(card!.custoMedio.valor).toBeCloseTo(0.8985, 3);
      expect(card!.totais.gasto).toBeCloseTo(269.55, 2);
      expect(card!.temCusto).toBe(true);
      expect(card!.totalDestaque.tipo).toBe('gasto');
    });

    it('Caso 2 PDF: tanque cheio em campo — 350 L / 8 h, sem financeiro', () => {
      const abastecimentos: AbastecimentoConsumoInput[] = [
        abast({
          id: 'a0',
          createdAt: '2025-06-01T08:00:00.000Z',
          liters: 400,
          currentReading: 1000,
        }),
        abast({
          id: 'a1',
          createdAt: '2025-06-02T18:00:00.000Z',
          liters: 350,
          currentReading: 1008,
        }),
      ];

      const card = buildVeiculoCard(
        'eq-1',
        abastecimentos,
        { descricao: 'Escavadeira', unidadeRevisao: 'h' },
        '2025-06-01T00:00:00.000Z',
        '2025-06-30T23:59:59.999Z',
      );

      expect(card!.consumoMedio.valor).toBeCloseTo(43.75, 2);
      expect(card!.custoMedio.valor).toBeNull();
      expect(card!.temCusto).toBe(false);
      expect(card!.totalDestaque.tipo).toBe('litros');
      expect(card!.totais.litros).toBe(350);
      expect(card!.totais.gasto).toBe(0);
    });

    it('infere L/h para escavadeira sem unidadeRevisao (tipo + linha amarela)', () => {
      const abastecimentos: AbastecimentoConsumoInput[] = [
        abast({
          id: 'a0',
          createdAt: '2025-06-01T08:00:00.000Z',
          liters: 100,
          currentReading: 1000,
          measurementType: 'hodometro',
        }),
        abast({
          id: 'a1',
          createdAt: '2025-06-10T18:00:00.000Z',
          liters: 80,
          currentReading: 1010,
          measurementType: 'hodometro',
        }),
      ];

      const card = buildVeiculoCard(
        'eq-1',
        abastecimentos,
        {
          descricao: 'Escavadeira CAT 320',
          linha: 'Linha Amarela',
          tipo: 'Escavadeira',
        },
        '2025-06-01T00:00:00.000Z',
        '2025-06-30T23:59:59.999Z',
      );

      expect(card!.unidadeMedicao).toBe('h');
      expect(card!.consumoMedio.valor).toBeCloseTo(8, 2);
      expect(card!.consumoMedio.valorExibicao).toContain('L/h');
    });

    it('usa unidadeRevisao do equipamento (h) mesmo com abastecimento hodometro', () => {
      const abastecimentos: AbastecimentoConsumoInput[] = [
        abast({
          id: 'a0',
          createdAt: '2025-06-01T10:00:00.000Z',
          liters: 50,
          currentReading: 100,
          measurementType: 'hodometro',
        }),
        abast({
          id: 'a1',
          createdAt: '2025-06-15T12:00:00.000Z',
          liters: 60,
          currentReading: 110,
          measurementType: 'hodometro',
          total: 360,
        }),
      ];

      const card = buildVeiculoCard(
        'eq-1',
        abastecimentos,
        { descricao: 'Retroescavadeira', unidadeRevisao: 'h' },
        '2025-06-01T00:00:00.000Z',
        '2025-06-30T23:59:59.999Z',
      );

      expect(card!.unidadeMedicao).toBe('h');
      expect(card!.consumoMedio.valor).toBeCloseTo(6, 2);
      expect(card!.custoMedio.valor).toBeCloseTo(36, 2);
    });

    it('usa abastecimento anterior ao período como baseline da leitura', () => {
      const abastecimentos: AbastecimentoConsumoInput[] = [
        abast({
          id: 'a0',
          createdAt: '2025-05-20T10:00:00.000Z',
          liters: 40,
          currentReading: 500,
          measurementType: 'hodometro',
        }),
        abast({
          id: 'a1',
          createdAt: '2025-06-10T10:00:00.000Z',
          liters: 30,
          currentReading: 510,
          measurementType: 'hodometro',
        }),
      ];

      const card = buildVeiculoCard(
        'eq-1',
        abastecimentos,
        { unidadeRevisao: 'km' },
        '2025-06-01T00:00:00.000Z',
        '2025-06-30T23:59:59.999Z',
      );

      expect(card!.consumoMedio.valor).toBeCloseTo(3, 2);
    });

    it('não exibe média com um único abastecimento no período (sem intervalo)', () => {
      const abastecimentos: AbastecimentoConsumoInput[] = [
        abast({
          id: 'a1',
          createdAt: '2025-06-10T10:00:00.000Z',
          liters: 80,
          currentReading: 200,
          measurementType: 'hodometro',
        }),
      ];

      const card = buildVeiculoCard(
        'eq-1',
        abastecimentos,
        { unidadeRevisao: 'km' },
        '2025-06-01T00:00:00.000Z',
        '2025-06-30T23:59:59.999Z',
      );

      expect(card!.consumoMedio.valor).toBeNull();
      expect(card!.totais.litros).toBe(0);
    });
  });
});
