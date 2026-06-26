import { agruparThreadsPosto } from './suporte-inbox.helper';
import type { SuporteMensagemApi } from '../suporte.types';

function msg(
  partial: Partial<SuporteMensagemApi> & Pick<SuporteMensagemApi, 'id'>,
): SuporteMensagemApi {
  return {
    postoId: 'posto-1',
    channel: 'financeiro',
    sender: 'user',
    text: 'teste',
    createdAt: '2026-06-26T10:00:00.000Z',
    ...partial,
  };
}

describe('agruparThreadsPosto', () => {
  it('agrupa por posto e canal com última mensagem', () => {
    const threads = agruparThreadsPosto([
      msg({
        id: 'm1',
        text: 'primeira',
        createdAt: '2026-06-26T10:00:00.000Z',
      }),
      msg({
        id: 'm2',
        text: 'última',
        createdAt: '2026-06-26T11:00:00.000Z',
      }),
    ]);

    expect(threads).toHaveLength(1);
    expect(threads[0].lastMessage).toBe('última');
    expect(threads[0].lastSender).toBe('user');
  });

  it('conta mensagens do operador sem adminReadAt', () => {
    const threads = agruparThreadsPosto([
      msg({ id: 'm1', adminReadAt: null }),
      msg({
        id: 'm2',
        createdAt: '2026-06-26T11:00:00.000Z',
        adminReadAt: '2026-06-26T12:00:00.000Z',
      }),
    ]);

    expect(threads[0].unreadUserCount).toBe(1);
  });

  it('ignora mensagens de boas-vindas', () => {
    const threads = agruparThreadsPosto([
      msg({ id: 'welcome-financeiro', sender: 'support' }),
    ]);

    expect(threads).toHaveLength(0);
  });

  it('ordena threads pela mensagem mais recente', () => {
    const threads = agruparThreadsPosto([
      msg({
        id: 'a1',
        postoId: 'posto-a',
        createdAt: '2026-06-26T09:00:00.000Z',
      }),
      msg({
        id: 'b1',
        postoId: 'posto-b',
        createdAt: '2026-06-26T12:00:00.000Z',
      }),
    ]);

    expect(threads[0].postoId).toBe('posto-b');
  });
});
