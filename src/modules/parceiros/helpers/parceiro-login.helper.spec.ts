import {
  hashSenhaOperacional,
  mapParceiroLoginDoc,
} from './parceiro-login.helper';

describe('hashSenhaOperacional', () => {
  it('gera SHA-256 hex compatível com o front', () => {
    expect(hashSenhaOperacional('abc')).toHaveLength(64);
    expect(hashSenhaOperacional('abc')).toBe(hashSenhaOperacional('abc'));
  });
});

describe('mapParceiroLoginDoc', () => {
  it('mapeia login de oficina com officinaId', () => {
    const row = mapParceiroLoginDoc('doc-1', {
      nome: 'João',
      usuario: 'joao.ofi',
      vinculo: 'oficina',
      prefeituraId: 'pref-1',
      officinaId: 'of-1',
      perfil: 'gestor',
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    expect(row).toMatchObject({
      id: 'doc-1',
      usuario: 'joao.ofi',
      vinculo: 'oficina',
      officinaId: 'of-1',
    });
  });
});
