import {
  deveAplicarMedicaoChecklist,
  resolverLeituraChecklist,
} from './sync-medicao-from-texto.helper';

describe('sync-medicao-from-texto.helper', () => {
  describe('resolverLeituraChecklist', () => {
    it('prioriza horímetro sobre KM', () => {
      expect(
        resolverLeituraChecklist({ hourMeter: '6.890,2', km: '12.000' }),
      ).toEqual({ measurementType: 'horimetro', leitura: 6890.2 });
    });

    it('usa KM quando horímetro está vazio', () => {
      expect(resolverLeituraChecklist({ km: '45.000' })).toEqual({
        measurementType: 'hodometro',
        leitura: 45000,
      });
    });

    it('retorna null sem leitura válida', () => {
      expect(resolverLeituraChecklist({})).toBeNull();
      expect(resolverLeituraChecklist({ hourMeter: 'abc' })).toBeNull();
    });
  });

  describe('deveAplicarMedicaoChecklist', () => {
    it('aceita horímetro maior que a medição atual', () => {
      expect(
        deveAplicarMedicaoChecklist(
          { unidadeRevisao: 'h', medicaoAtual: 6800 },
          'horimetro',
          6890,
        ),
      ).toBe(true);
    });

    it('rejeita regressão de leitura', () => {
      expect(
        deveAplicarMedicaoChecklist(
          { unidadeRevisao: 'h', medicaoAtual: 7000 },
          'horimetro',
          6890,
        ),
      ).toBe(false);
    });

    it('não mistura km com equipamento em horas', () => {
      expect(
        deveAplicarMedicaoChecklist(
          { unidadeRevisao: 'h', medicaoAtual: 100 },
          'hodometro',
          5000,
        ),
      ).toBe(false);
    });
  });
});
