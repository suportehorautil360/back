import {
  paginateMensagens,
  withWelcomeMessage,
} from './suporte-mensagens.helper';

describe('suporte-mensagens.helper', () => {
  const base = (id: string, createdAt: string) => ({
    id,
    oficinaId: 'of-1',
    channel: 'ti' as const,
    sender: 'user' as const,
    text: id,
    createdAt,
  });

  it('pagina mensagens mais recentes', () => {
    const messages = [
      base('m1', '2026-06-16T10:00:00.000Z'),
      base('m2', '2026-06-16T11:00:00.000Z'),
      base('m3', '2026-06-16T12:00:00.000Z'),
    ];

    expect(paginateMensagens(messages, 2)).toHaveLength(2);
    expect(paginateMensagens(messages, 2).map((item) => item.id)).toEqual([
      'm2',
      'm3',
    ]);
  });

  it('inclui boas-vindas quando não há histórico', () => {
    const messages = withWelcomeMessage('of-1', 'ti', []);

    expect(messages).toHaveLength(1);
    expect(messages[0].id).toBe('welcome-ti');
    expect(messages[0].sender).toBe('support');
  });
});
