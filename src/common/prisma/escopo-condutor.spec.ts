import { equipamentoNoEscopo, escopoDoApp } from './escopo-condutor';

describe('escopoDoApp', () => {
  it('checklist aceita condutor de qualquer equipamento', () => {
    expect(escopoDoApp('checklist')).toBe('qualquer');
  });

  // Compatibilidade: FleetFuel e PWA comboista já estão em produção contra
  // este endpoint. Mudar o comportamento deles aqui derruba os dois.
  it('comboio (padrão) continua restrito a comboios', () => {
    expect(escopoDoApp('comboio')).toBe('comboio');
    expect(escopoDoApp(undefined)).toBe('comboio');
  });

  it('motorista continua excluindo comboios', () => {
    expect(escopoDoApp('motorista')).toBe('fora-de-comboio');
  });
});

describe('equipamentoNoEscopo', () => {
  it('qualquer aceita comboio e não-comboio', () => {
    expect(equipamentoNoEscopo('comboio', 'qualquer')).toBe(true);
    expect(equipamentoNoEscopo('retroescavadeira', 'qualquer')).toBe(true);
  });

  it('comboio aceita só comboio', () => {
    expect(equipamentoNoEscopo('comboio', 'comboio')).toBe(true);
    expect(equipamentoNoEscopo('retroescavadeira', 'comboio')).toBe(false);
  });

  it('fora-de-comboio recusa comboio', () => {
    expect(equipamentoNoEscopo('comboio', 'fora-de-comboio')).toBe(false);
    expect(equipamentoNoEscopo('retroescavadeira', 'fora-de-comboio')).toBe(
      true,
    );
  });
});
