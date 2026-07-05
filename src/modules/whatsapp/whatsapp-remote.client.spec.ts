import { ConfigService } from '@nestjs/config';
import { WhatsAppRemoteClient } from './whatsapp-remote.client';

describe('WhatsAppRemoteClient', () => {
  const fetchMock = jest.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  function client(url = 'https://wa.example.com/whatsapp') {
    const config = {
      get: (key: string) => {
        if (key === 'WHATSAPP_SERVICE_URL') return url;
        if (key === 'WHATSAPP_SERVICE_SECRET') return 'secret-test';
        return undefined;
      },
    } as unknown as ConfigService;
    return new WhatsAppRemoteClient(config);
  }

  it('isEnabled quando WHATSAPP_SERVICE_URL está definido', () => {
    expect(client().isEnabled()).toBe(true);
    expect(client('').isEnabled()).toBe(false);
  });

  it('envia x-admin-secret e parseia data', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ data: { status: 'conectado' }, message: 'ok' }),
    });

    const status = await client().getStatus();

    expect(status.status).toBe('conectado');
    expect(fetchMock).toHaveBeenCalledWith(
      'https://wa.example.com/whatsapp/status',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({ 'x-admin-secret': 'secret-test' }),
      }),
    );
  });

  it('estaConectado retorna false quando o serviço falha', async () => {
    fetchMock.mockRejectedValue(new Error('offline'));

    await expect(client().estaConectado()).resolves.toBe(false);
  });
});
