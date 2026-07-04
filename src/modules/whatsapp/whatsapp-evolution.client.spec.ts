import { ConfigService } from '@nestjs/config';
import { WhatsAppEvolutionClient } from './whatsapp-evolution.client';
import { WhatsAppMetricsService } from './whatsapp-metrics.service';

describe('WhatsAppEvolutionClient', () => {
  const fetchMock = jest.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  function client(instance = 'hora-util') {
    const config = {
      get: (key: string) => {
        if (key === 'EVOLUTION_BASE_URL') {
          return 'evolution-api-production-4ef6.up.railway.app';
        }
        if (key === 'EVOLUTION_AUTH_KEY') return 'secret-evolution';
        if (key === 'EVOLUTION_INSTANCE') return instance;
        return undefined;
      },
    } as unknown as ConfigService;

    const metrics = {
      incrementarMensagens: jest.fn().mockResolvedValue(undefined),
      contarEmpresasUtilizando: jest.fn().mockResolvedValue(0),
      mensagensHoje: jest.fn().mockResolvedValue(0),
      mensagens30d: jest.fn().mockResolvedValue(0),
      eventosRecentes: jest.fn().mockResolvedValue([]),
      eventosJanela: jest.fn().mockResolvedValue([]),
    } as unknown as WhatsAppMetricsService;

    return new WhatsAppEvolutionClient(config, metrics);
  }

  it('envia texto via sendText com apikey', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ key: { id: '1' } }),
    });

    await client().enviarMensagem('67 99999-9999', 'Olá');

    expect(fetchMock).toHaveBeenCalledWith(
      'https://evolution-api-production-4ef6.up.railway.app/message/sendText/hora-util',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          apikey: 'secret-evolution',
        }),
        body: JSON.stringify({
          number: '5567999999999',
          text: 'Olá',
        }),
      }),
    );
  });

  it('mapeia state open para conectado', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        instance: { instanceName: 'hora-util', state: 'open' },
      }),
    });

    await expect(client().estaConectado()).resolves.toBe(true);
  });
});
