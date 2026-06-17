import {
  especialidadeCompativel,
  normEsp,
} from './norm-esp.helper';

describe('normEsp', () => {
  it('remove acentos e normaliza caixa', () => {
    expect(normEsp('Linha Amarela')).toBe('linha amarela');
    expect(normEsp('  PESADA  ')).toBe('pesada');
  });
});

describe('especialidadeCompativel', () => {
  it('aceita igualdade exata', () => {
    expect(especialidadeCompativel('Amarela', 'amarela')).toBe(true);
  });

  it('aceita includes bidirecional (regra do front antigo)', () => {
    expect(especialidadeCompativel('Amarela', 'Linha Amarela')).toBe(true);
    expect(especialidadeCompativel('Linha Amarela', 'Amarela')).toBe(true);
  });

  it('rejeita linhas sem relação', () => {
    expect(especialidadeCompativel('Pesada', 'Amarela')).toBe(false);
  });
});
