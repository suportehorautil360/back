import {
  credenciaisLoginAutomatico,
  gerarSenhaInicial,
  montarUsuarioLogin,
  slugLoginBase,
} from './gerar-credenciais-parceiro.helper';

describe('gerar-credenciais-parceiro', () => {
  it('slugLoginBase remove acentos e espaços', () => {
    expect(slugLoginBase('Posto Três Lagoas')).toBe('posto.tres.lagoas');
  });

  it('montarUsuarioLogin inclui tipo e sufixo do id', () => {
    const u = montarUsuarioLogin(
      'oficina',
      'Mecânica Sul',
      'abc12345-6789-0000-0000-000000000001',
    );
    expect(u.startsWith('oficina.mecanica.sul.')).toBe(true);
    expect(u.length).toBeGreaterThan(10);
  });

  it('gerarSenhaInicial tem tamanho mínimo 4', () => {
    expect(gerarSenhaInicial().length).toBe(8);
  });

  it('credenciaisLoginAutomatico monta pacote completo', () => {
    const c = credenciaisLoginAutomatico('posto', 'id-parceiro-123456', {
      nomeExibicao: 'Posto Centro',
      slugBase: 'Posto Centro',
    });
    expect(c.nome).toBe('Posto Centro');
    expect(c.usuario).toContain('posto.');
    expect(c.senhaInicial.length).toBeGreaterThanOrEqual(4);
  });
});
