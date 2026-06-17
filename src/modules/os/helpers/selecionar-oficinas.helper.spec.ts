import type { OficinaAtiva } from '../os.types';
import { selecionarOficinas } from './selecionar-oficinas.helper';

const oficinas: OficinaAtiva[] = [
  { id: '1', nome: 'A', especialidade: 'Amarela' },
  { id: '2', nome: 'B', especialidade: 'Amarela' },
  { id: '3', nome: 'C', especialidade: 'Amarela' },
  { id: '4', nome: 'D', especialidade: 'Amarela' },
  { id: '5', nome: 'E', especialidade: 'Pesada' },
];

describe('selecionarOficinas', () => {
  it('retorna vazio quando não há oficinas', () => {
    expect(selecionarOficinas([], 'Amarela')).toEqual([]);
  });

  it('limita a 3 oficinas', () => {
    const result = selecionarOficinas(oficinas, 'Amarela', 3);
    expect(result).toHaveLength(3);
    expect(result.every((o) => o.especialidade === 'Amarela')).toBe(true);
  });

  it('retorna 1 oficina quando só há uma compatível', () => {
    const result = selecionarOficinas(oficinas, 'Pesada', 3);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('5');
  });

  it('usa fallback de todas quando linha não tem match', () => {
    const result = selecionarOficinas(oficinas, 'Verde', 3);
    expect(result.length).toBeGreaterThan(0);
    expect(result.length).toBeLessThanOrEqual(3);
  });
});
