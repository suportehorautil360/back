import { ConfigService } from '@nestjs/config';
import {
  extractEvolutionErrorMessage,
  sanitizeEvolutionPayloadForLog,
  WhatsAppEvolutionClient,
} from './whatsapp-evolution.client';
import { WhatsAppMetricsService } from './whatsapp-metrics.service';

describe('extractEvolutionErrorMessage', () => {
  it('lê message aninhada em response', () => {
    expect(
      extractEvolutionErrorMessage(
        {
          status: 400,
          error: 'Bad Request',
          response: { message: ['Número inválido'] },
        },
        400,
      ),
    ).toBe('Número inválido');
  });

  it('lê message no topo', () => {
    expect(
      extractEvolutionErrorMessage({ message: 'Instance not found' }, 404),
    ).toBe('Instance not found');
  });
});

describe('sanitizeEvolutionPayloadForLog', () => {
  it('trunca media base64 longa', () => {
    const media = 'data:image/jpeg;base64,' + 'A'.repeat(200);
    const out = sanitizeEvolutionPayloadForLog({
      number: '5511994892766',
      media,
    }) as { media: string; number: string };
    expect(out.number).toBe('5511994892766');
    expect(out.media).toContain('…[');
    expect(out.media).toContain('chars]');
  });
});

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

  it('loga detalhe quando sendText retorna 400', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({
        status: 400,
        error: 'Bad Request',
        response: { message: ['Invalid number'] },
      }),
    });

    await expect(client().enviarMensagem('11 99489-2766', 'teste')).rejects.toThrow(
      'Invalid number',
    );
  });

  it('envia imagem como base64 puro (sem data URL)', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ key: { id: '1' } }),
    });

    await client().enviarImagem(
      '11 99489-2766',
      'data:image/jpeg;base64,/9j/foto',
      'legenda',
    );

    expect(fetchMock).toHaveBeenCalledWith(
      'https://evolution-api-production-4ef6.up.railway.app/message/sendMedia/hora-util',
      expect.objectContaining({
        body: JSON.stringify({
          number: '5511994892766',
          mediatype: 'image',
          mimetype: 'image/jpeg',
          caption: 'legenda',
          media: '/9j/foto',
        }),
      }),
    );
  });
});
