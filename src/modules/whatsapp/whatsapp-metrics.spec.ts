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
