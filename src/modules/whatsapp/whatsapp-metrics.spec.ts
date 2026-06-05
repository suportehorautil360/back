import { contarEmpresasComWhats } from './whatsapp-metrics';

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

import { calcularDisponibilidade } from './whatsapp-metrics';

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
});
