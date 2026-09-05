import { decodificarCursor, codificarCursor } from './cursor';

describe('cursor de sincronização', () => {
  it('leva e traz a posição sem perder precisão do instante', () => {
    // Milissegundo perdido no vai e vem faz o pull reenviar ou, pior, pular
    // registros gravados naquele milissegundo.
    const pos = {
      atualizadoEm: new Date('2026-09-05T02:17:35.018Z'),
      id: 'abc-1',
    };
    expect(decodificarCursor(codificarCursor(pos))).toEqual(pos);
  });

  it('cursor ausente significa "desde o começo"', () => {
    expect(decodificarCursor(undefined)).toBeNull();
    expect(decodificarCursor('')).toBeNull();
  });

  it('cursor corrompido é tratado como começo, não derruba o pull', () => {
    // O aparelho pode ter guardado lixo. Recomeçar é caro mas correto;
    // estourar deixaria o operador sem frota nenhuma.
    expect(decodificarCursor('nao-e-base64-valido!!')).toBeNull();
    expect(
      decodificarCursor(Buffer.from('{"lixo":1}').toString('base64url')),
    ).toBeNull();
  });

  it('o cursor é opaco para o cliente', () => {
    // O app nunca monta "updated_at > X" sozinho: quem decide a estratégia de
    // paginação é o servidor, e ele pode mudá-la sem quebrar aparelho em campo.
    const s = codificarCursor({ atualizadoEm: new Date(0), id: 'x' });
    expect(s).not.toContain('updated_at');
    expect(s).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});
