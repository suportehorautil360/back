import {
  calcularSaldo,
  calcularTotal,
  combustivelCompativel,
  ehCombustivelDiesel,
  familiaCombustivel,
  limiteRevisao,
  odometroIncoerente,
  revisaoObrigatoria,
} from './fleetfuel-rules.helper';

describe('fleetfuel-rules.helper', () => {
  describe('familiaCombustivel', () => {
    it('classifica diesel S-10 e S-500 como diesel', () => {
      expect(familiaCombustivel('Diesel S-10')).toBe('diesel');
      expect(familiaCombustivel('Diesel S-500')).toBe('diesel');
      expect(familiaCombustivel('Diesel')).toBe('diesel');
    });
    it('classifica gasolinas', () => {
      expect(familiaCombustivel('Gasolina Comum')).toBe('gasolina');
      expect(familiaCombustivel('Gasolina Aditivada')).toBe('gasolina');
    });
    it('classifica etanol, gnv e desconhecido', () => {
      expect(familiaCombustivel('Etanol')).toBe('etanol');
      expect(familiaCombustivel('GNV')).toBe('gnv');
      expect(familiaCombustivel('Flex')).toBe('desconhecido');
      expect(familiaCombustivel('')).toBe('desconhecido');
    });
  });

  describe('combustivelCompativel', () => {
    it('bloqueia diesel em veículo a gasolina', () => {
      expect(combustivelCompativel('Gasolina', 'Diesel S-10')).toBe(false);
    });
    it('aceita diesel S-500 em veículo diesel', () => {
      expect(combustivelCompativel('Diesel', 'Diesel S-500')).toBe(true);
    });
    it('não bloqueia quando família é desconhecida (flex / sem cadastro)', () => {
      expect(combustivelCompativel('Flex', 'Etanol')).toBe(true);
      expect(combustivelCompativel('', 'Diesel S-10')).toBe(true);
    });
  });

  describe('ehCombustivelDiesel', () => {
    it('aceita diesel e variantes S10/S500', () => {
      expect(ehCombustivelDiesel('Diesel')).toBe(true);
      expect(ehCombustivelDiesel('Diesel S10')).toBe(true);
    });
    it('rejeita gasolina, etanol, gnv, flex e vazio', () => {
      expect(ehCombustivelDiesel('Gasolina')).toBe(false);
      expect(ehCombustivelDiesel('Etanol')).toBe(false);
      expect(ehCombustivelDiesel('GNV')).toBe(false);
      expect(ehCombustivelDiesel('Flex')).toBe(false);
      expect(ehCombustivelDiesel('')).toBe(false);
    });
  });

  describe('odometroIncoerente', () => {
    it('bloqueia KM menor que o último registro', () => {
      expect(odometroIncoerente(120000, 125200)).toBe(true);
    });
    it('aceita KM igual ou maior', () => {
      expect(odometroIncoerente(125200, 125200)).toBe(false);
      expect(odometroIncoerente(130000, 125200)).toBe(false);
    });
    it('não bloqueia sem referência', () => {
      expect(odometroIncoerente(1000, undefined)).toBe(false);
      expect(odometroIncoerente(1000, null)).toBe(false);
    });
  });

  describe('limiteRevisao / revisaoObrigatoria', () => {
    it('calcula limite = última + intervalo', () => {
      expect(limiteRevisao(120000, 10000)).toBe(130000);
    });
    it('sem intervalo válido => null e não bloqueia', () => {
      expect(limiteRevisao(120000, 0)).toBeNull();
      expect(revisaoObrigatoria(999999, 120000, 0)).toBe(false);
    });
    it('bloqueia quando KM atinge o limite', () => {
      expect(revisaoObrigatoria(130000, 120000, 10000)).toBe(true);
      expect(revisaoObrigatoria(129999, 120000, 10000)).toBe(false);
    });
  });

  describe('calcularSaldo / calcularTotal', () => {
    it('saldo = creditado - gasto', () => {
      expect(calcularSaldo(15000, 0)).toBe(15000);
      expect(calcularSaldo(15000, 5000.5)).toBe(9999.5);
    });
    it('entradas inválidas contam como 0', () => {
      expect(calcularSaldo(undefined, null)).toBe(0);
    });
    it('total = litros * preço', () => {
      expect(calcularTotal(1, 5.5)).toBe(5.5);
      expect(calcularTotal(10.123, 6.12)).toBe(61.95);
    });
  });
});
