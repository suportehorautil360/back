import {
  calcularMetricasIntervalo,
  resolveGastoAbastecimento,
  tipoMedidaFromEquipamento,
} from './calcular-metricas-frota.helper';

describe('calcular-metricas-frota (spec V2)', () => {
  it('Caso 1: frota rodoviária com valor comercial (KM)', () => {
    const r = calcularMetricasIntervalo({
      tipoMedida: 'KM',
      litrosAbastecidos: 45,
      leituraAtual: 300,
      leituraAnterior: 0,
      precoLitro: 5.99,
    });

    expect(r).not.toBeNull();
    expect(r!.consumoMedio).toBeCloseTo(0.15, 4);
    expect(r!.gastoTotal).toBeCloseTo(269.55, 2);
    expect(r!.custoUnitario).toBeCloseTo(0.8985, 3);
    expect(r!.sufixoConsumo).toBe('L/km');
    expect(r!.sufixoCusto).toBe('R$/km');
  });

  it('Caso 2: equipamento de campo (HORA) sem preço', () => {
    const r = calcularMetricasIntervalo({
      tipoMedida: 'HORA',
      litrosAbastecidos: 350,
      leituraAtual: 1008,
      leituraAnterior: 1000,
    });

    expect(r).not.toBeNull();
    expect(r!.consumoMedio).toBeCloseTo(43.75, 2);
    expect(r!.gastoTotal).toBeNull();
    expect(r!.custoUnitario).toBeNull();
    expect(r!.sufixoConsumo).toBe('L/h');
  });

  it('retorna null quando leitura não avança', () => {
    expect(
      calcularMetricasIntervalo({
        tipoMedida: 'KM',
        litrosAbastecidos: 40,
        leituraAtual: 100,
        leituraAnterior: 100,
      }),
    ).toBeNull();
  });

  it('resolveGastoAbastecimento a partir de total ÷ litros', () => {
    expect(resolveGastoAbastecimento(45, null, 269.55)).toBeCloseTo(269.55, 2);
  });

  it('tipoMedidaFromEquipamento identifica máquinas pela linha/tipo', () => {
    expect(
      tipoMedidaFromEquipamento({
        descricao: 'Komatsu PC210',
        linha: 'Linha Amarela',
      }),
    ).toBe('HORA');
    expect(
      tipoMedidaFromEquipamento({
        descricao: 'Fiat Uno',
        tipo: 'Carro',
      }),
    ).toBeNull();
  });
});
