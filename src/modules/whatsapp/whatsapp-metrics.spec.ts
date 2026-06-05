import {
  contarEmpresasComWhats,
  calcularDisponibilidade,
  ultimosDias,
  montarOverview,
} from './whatsapp-metrics';

describe('whatsapp-metrics/contarEmpresasComWhats', () => {
  it('conta só quem tem toggle on e número preenchido', () => {
    const configs = [
      { alertas: { notificacaoWhatsapp: true }, empresa: { whatsappNumero: '67 99999-9999' } },
      { alertas: { notificacaoWhatsapp: true }, empresa: { whatsappNumero: '   ' } }, // número vazio
      { alertas: { notificacaoWhatsapp: false }, empresa: { whatsappNumero: '11 98888-7777' } }, // toggle off
      { empresa: { whatsappNumero: '11 97777-6666' } }, // sem alertas
      {}, // vazio
    ];
    expect(contarEmpresasComWhats(configs)).toBe(1);
  });

  it('retorna 0 para lista vazia', () => {
    expect(contarEmpresasComWhats([])).toBe(0);
  });
});

describe('whatsapp-metrics/calcularDisponibilidade', () => {
  const agora = new Date('2026-06-05T12:00:00.000Z');

  it('sem eventos → 0%, janela incompleta', () => {
    const r = calcularDisponibilidade([], agora, 30);
    expect(r.percentual).toBe(0);
    expect(r.janelaCompleta).toBe(false);
    expect(r.desde).toBe(agora.toISOString());
  });

  it('conectado metade do período medido → 50%', () => {
    // primeiro evento há 1 dia; conectado por 12h das 24h
    const eventos = [
      { tipo: 'conectado' as const, timestamp: '2026-06-04T12:00:00.000Z' },
      { tipo: 'queda' as const, timestamp: '2026-06-05T00:00:00.000Z' },
    ];
    const r = calcularDisponibilidade(eventos, agora, 30);
    expect(r.percentual).toBe(50);
    expect(r.janelaCompleta).toBe(false); // só 1 dia de histórico < 30
    expect(r.desde).toBe('2026-06-04T12:00:00.000Z');
  });

  it('conectado e ainda aberto até agora → 100%', () => {
    const eventos = [
      { tipo: 'conectado' as const, timestamp: '2026-06-04T12:00:00.000Z' },
    ];
    const r = calcularDisponibilidade(eventos, agora, 30);
    expect(r.percentual).toBe(100);
  });

  it('janelaCompleta quando há evento mais antigo que a janela', () => {
    const eventos = [
      { tipo: 'conectado' as const, timestamp: '2026-04-01T00:00:00.000Z' },
    ];
    const r = calcularDisponibilidade(eventos, agora, 30);
    expect(r.janelaCompleta).toBe(true);
    expect(r.desde).toBe('2026-05-06T12:00:00.000Z'); // agora - 30d
  });

  it('dois eventos conectado seguidos — não duplica uptime', () => {
    const eventos = [
      { tipo: 'conectado' as const, timestamp: '2026-06-04T00:00:00.000Z' },
      { tipo: 'conectado' as const, timestamp: '2026-06-04T06:00:00.000Z' }, // duplicado — deve ser ignorado
      { tipo: 'queda' as const, timestamp: '2026-06-05T12:00:00.000Z' }, // queda no momento de agora
    ];
    const r = calcularDisponibilidade(eventos, agora, 30);
    expect(r.percentual).toBe(100); // 36h conectado de 36h medidas, sem ultrapassar 100%
  });

  it('queda sem conectado anterior — ignora e não conta negativo', () => {
    const eventos = [
      { tipo: 'queda' as const, timestamp: '2026-06-04T12:00:00.000Z' }, // queda sem abertura prévia
      { tipo: 'conectado' as const, timestamp: '2026-06-05T00:00:00.000Z' }, // aberto até agora (12h)
    ];
    const r = calcularDisponibilidade(eventos, agora, 30);
    expect(r.percentual).toBe(50); // 12h conectado de 24h medidas
  });
});

describe('whatsapp-metrics/ultimosDias', () => {
  it('gera N ids YYYY-MM-DD terminando hoje (desc)', () => {
    const dias = ultimosDias(3, new Date('2026-06-05T12:00:00.000Z'));
    expect(dias).toEqual(['2026-06-05', '2026-06-04', '2026-06-03']);
  });
});

describe('whatsapp-metrics/montarOverview', () => {
  it('monta o payload completo', () => {
    const ov = montarOverview({
      status: 'conectado',
      qrImagem: undefined,
      numeroConectado: '5567999999999',
      nomeSessao: 'Hora Útil 360',
      conectadoDesde: '2026-06-05T09:42:00.000Z',
      ultimaAtividade: '2026-06-05T11:58:00.000Z',
      versaoSessao: '2.3000.1',
      ambiente: 'prod',
      empresasUtilizando: 14,
      mensagensHoje: 234,
      mensagens30d: 5120,
      disponibilidade: { percentual: 99.8, desde: '2026-05-06T12:00:00.000Z', janelaCompleta: true },
      eventos: [{ id: 'e1', tipo: 'conectado', status: 'sucesso', timestamp: '2026-06-05T09:42:00.000Z' }],
    });
    expect(ov).toEqual({
      status: 'conectado',
      qrImagem: undefined,
      sessao: {
        numeroConectado: '5567999999999',
        nomeSessao: 'Hora Útil 360',
        conectadoDesde: '2026-06-05T09:42:00.000Z',
        ultimaAtividade: '2026-06-05T11:58:00.000Z',
        versaoSessao: '2.3000.1',
        ambiente: 'prod',
      },
      kpis: {
        empresasUtilizando: 14,
        mensagensHoje: 234,
        mensagens30d: 5120,
        disponibilidade: { percentual: 99.8, desde: '2026-05-06T12:00:00.000Z', janelaCompleta: true },
      },
      eventos: [{ id: 'e1', tipo: 'conectado', status: 'sucesso', timestamp: '2026-06-05T09:42:00.000Z' }],
    });
  });
});
