import {
  deveAtualizarMedicaoAtual,
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

  describe('deveAtualizarMedicaoAtual', () => {
    it('atualiza quando a unidade bate e a leitura é maior', () => {
      expect(deveAtualizarMedicaoAtual('km', 'hodometro', 40000, 55000)).toBe(
        true,
      );
      expect(deveAtualizarMedicaoAtual('h', 'horimetro', 1800, 1840)).toBe(
        true,
      );
    });

    it('não atualiza quando a leitura é igual/menor', () => {
      expect(deveAtualizarMedicaoAtual('km', 'hodometro', 55000, 55000)).toBe(
        false,
      );
      expect(deveAtualizarMedicaoAtual('km', 'hodometro', 60000, 55000)).toBe(
        false,
      );
    });

    it('não mistura unidades (km do equipamento × horímetro do abastecimento)', () => {
      expect(deveAtualizarMedicaoAtual('km', 'horimetro', 0, 9999)).toBe(false);
      expect(deveAtualizarMedicaoAtual('h', 'hodometro', 0, 9999)).toBe(false);
    });

    it('unidade desconhecida: atualiza só pela regra monotônica', () => {
      expect(deveAtualizarMedicaoAtual(undefined, 'hodometro', 100, 200)).toBe(
        true,
      );
      expect(deveAtualizarMedicaoAtual(undefined, 'hodometro', 200, 100)).toBe(
        false,
      );
    });

    it('medicaoAtual ausente/inválida => atualiza (primeira leitura)', () => {
      expect(
        deveAtualizarMedicaoAtual('km', 'hodometro', undefined, 55000),
      ).toBe(true);
    });

    it('measurementType inválido => não atualiza', () => {
      expect(deveAtualizarMedicaoAtual('km', 'odometro', 0, 999)).toBe(false);
    });
  });
});
