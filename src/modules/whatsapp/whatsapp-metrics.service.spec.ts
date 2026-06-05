import { WhatsAppMetricsService } from './whatsapp-metrics.service';

function fakeFirebase() {
  const setMensagens = jest.fn().mockResolvedValue(undefined);
  const addEvento = jest.fn().mockResolvedValue(undefined);
  const configsData = [
    { alertas: { notificacaoWhatsapp: true }, empresa: { whatsappNumero: '67 99999-9999' } },
    { alertas: { notificacaoWhatsapp: false }, empresa: { whatsappNumero: '11 90000-0000' } },
  ];
  const db = {
    collection: jest.fn((name: string) => {
      if (name === 'whatsappStats') {
        return { doc: () => ({ set: setMensagens, get: async () => ({ data: () => ({ mensagens: 7 }) }) }) };
      }
      if (name === 'whatsappEvents') {
        return { add: addEvento };
      }
      if (name === 'configuracoes') {
        return { get: async () => ({ docs: configsData.map((d) => ({ data: () => d })) }) };
      }
      throw new Error('coleção inesperada: ' + name);
    }),
  };
  const firebase = {
    getFirestore: () => db,
    FieldValue: { increment: (n: number) => ({ __inc: n }) },
  } as any;
  return { firebase, setMensagens, addEvento };
}

describe('WhatsAppMetricsService', () => {
  it('incrementarMensagens faz set merge com increment', async () => {
    const { firebase, setMensagens } = fakeFirebase();
    const svc = new WhatsAppMetricsService(firebase);
    await svc.incrementarMensagens(2);
    expect(setMensagens).toHaveBeenCalledWith(
      { mensagens: { __inc: 2 } },
      { merge: true },
    );
  });

  it('mensagensHoje lê o doc do dia', async () => {
    const { firebase } = fakeFirebase();
    const svc = new WhatsAppMetricsService(firebase);
    await expect(svc.mensagensHoje()).resolves.toBe(7);
  });

  it('registrarEvento grava na coleção de eventos', async () => {
    const { firebase, addEvento } = fakeFirebase();
    const svc = new WhatsAppMetricsService(firebase);
    await svc.registrarEvento('conectado', 'sucesso');
    expect(addEvento).toHaveBeenCalledTimes(1);
    const arg = addEvento.mock.calls[0][0];
    expect(arg.tipo).toBe('conectado');
    expect(arg.status).toBe('sucesso');
    expect(typeof arg.timestamp).toBe('string');
  });

  it('contarEmpresasUtilizando aplica o filtro', async () => {
    const { firebase } = fakeFirebase();
    const svc = new WhatsAppMetricsService(firebase);
    await expect(svc.contarEmpresasUtilizando()).resolves.toBe(1);
  });
});
