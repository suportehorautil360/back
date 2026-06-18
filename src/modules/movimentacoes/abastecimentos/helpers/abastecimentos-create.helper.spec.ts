import {
  isSupportedMeasurementType,
  maiorLeituraRegistrada,
  matchesPlateOrChassis,
} from './abastecimentos-create.helper';

describe('abastecimentos-create.helper', () => {
  describe('isSupportedMeasurementType', () => {
    it('aceita horimetro/hodometro e rejeita o resto', () => {
      expect(isSupportedMeasurementType('horimetro')).toBe(true);
      expect(isSupportedMeasurementType('hodometro')).toBe(true);
      expect(isSupportedMeasurementType('odometro')).toBe(false);
    });
  });

  describe('matchesPlateOrChassis', () => {
    it('casa placa/chassi ignorando pontuação e caixa', () => {
      expect(matchesPlateOrChassis({ placa: 'ABC-1234' }, 'abc1234')).toBe(
        true,
      );
      expect(matchesPlateOrChassis({ chassis: '9BWZZZ' }, '9bw-zzz')).toBe(
        true,
      );
      expect(matchesPlateOrChassis({ placa: 'ABC-1234' }, 'XYZ0000')).toBe(
        false,
      );
    });
  });

  describe('maiorLeituraRegistrada (leitura monotônica)', () => {
    const docs = [
      {
        prefeituraId: 'p1',
        measurementType: 'hodometro',
        currentReading: 55000,
      },
      {
        prefeituraId: 'p1',
        measurementType: 'hodometro',
        currentReading: 40000,
      },
      {
        prefeituraId: 'p1',
        measurementType: 'horimetro',
        currentReading: 1840,
      },
      // outra prefeitura — não conta
      {
        prefeituraId: 'p2',
        measurementType: 'hodometro',
        currentReading: 99999,
      },
    ];

    it('pega a maior leitura do mesmo tipo na mesma prefeitura', () => {
      expect(maiorLeituraRegistrada(docs, 'p1', 'hodometro')).toBe(55000);
      expect(maiorLeituraRegistrada(docs, 'p1', 'horimetro')).toBe(1840);
    });

    it('não mistura horímetro com hodômetro', () => {
      // só há horímetro 1840; pra hodômetro ignora esse
      const so = [
        {
          prefeituraId: 'p1',
          measurementType: 'horimetro',
          currentReading: 1840,
        },
      ];
      expect(maiorLeituraRegistrada(so, 'p1', 'hodometro')).toBeNull();
    });

    it('sem registros (ou leitura inválida) => null', () => {
      expect(maiorLeituraRegistrada([], 'p1', 'hodometro')).toBeNull();
      expect(
        maiorLeituraRegistrada(
          [
            {
              prefeituraId: 'p1',
              measurementType: 'hodometro',
              currentReading: 'x',
            },
          ],
          'p1',
          'hodometro',
        ),
      ).toBeNull();
    });
  });
});
