import {
  DEFAULT_POR_CARGO,
  normalizarPorCargo,
  resolverPorCargo,
} from './cargos-permissao.service';

describe('cargos-permissao helpers', () => {
  it('normaliza chaves e filtra grupos inválidos', () => {
    expect(
      normalizarPorCargo({
        ' Operador de Manutenção ': ['Manutenção', '', 1, 'Gestão de Frota'],
      }),
    ).toEqual({
      'operador de manutenção': ['Manutenção', 'Gestão de Frota'],
    });
  });

  it('resolverPorCargo aplica defaults e sobrescreve com o doc', () => {
    const resolved = resolverPorCargo({
      motorista: ['Manutenção'],
    });
    expect(resolved.motorista).toEqual(['Manutenção']);
    expect(resolved['operador de manutenção']).toEqual(
      DEFAULT_POR_CARGO['operador de manutenção'],
    );
    expect(resolved.operador).toEqual(DEFAULT_POR_CARGO.operador);
  });
});
