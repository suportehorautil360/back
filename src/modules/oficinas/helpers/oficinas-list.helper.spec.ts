import { mapOficinaListItem } from './oficinas-list.helper';

describe('oficinas/mapOficinaListItem', () => {
  it('mapeia parceiro global (sem prefeituraId)', () => {
    const item = mapOficinaListItem('of-1', {
      razaoSocial: 'Mecânica Silva LTDA',
      nomeFantasia: 'Mecânica Silva',
      cidadeUf: 'Goiânia/GO',
      especialidade: 'Amarela',
      status: 'Ativa',
      linhasAtuacao: ['Linha Amarela'],
      createdAt: '2026-01-10T12:00:00.000Z',
    });

    expect(item.id).toBe('of-1');
    expect(item.nome).toBe('Mecânica Silva');
    expect(item.especialidade).toBe('Amarela');
    expect(item.ativo).toBe(true);
    expect(item.prefeituraId).toBeNull();
    expect(item.parceiroId).toBeNull();
  });

  it('mapeia credenciamento municipal', () => {
    const item = mapOficinaListItem('cred-1', {
      prefeituraId: 'pref-abc',
      parceiroId: 'of-1',
      nome: 'Mecânica Silva',
      especialidade: 'Pesada',
      status: 'Ativa',
      credenciadoEm: '2026-02-01T10:00:00.000Z',
    });

    expect(item.prefeituraId).toBe('pref-abc');
    expect(item.parceiroId).toBe('of-1');
    expect(item.credenciadoEm).toBe('2026-02-01T10:00:00.000Z');
  });

  it('deriva especialidade de linhasAtuacao quando ausente', () => {
    const item = mapOficinaListItem('of-2', {
      nomeFantasia: 'Auto Center',
      linhasAtuacao: ['Linha Vermelha'],
      status: 'Suspensa',
    });

    expect(item.especialidade).toBe('Vermelha');
    expect(item.ativo).toBe(false);
  });
});
