import {
  EmergenciesService,
  DadosEmergenciaWhats,
} from './emergencies.service';

/**
 * Firestore falso para o caminho de `notificarWhatsApp`:
 * - `configuracoes` → doc de config da prefeitura (toggle + número da empresa);
 * - `allocations`   → alocação ativa do equipamento (workFrontId);
 * - `work-fronts`   → frente alocada (telefone).
 * Cada coleção é consultada uma vez via `.where(...).get()`.
 */
function makeFirebase(opts: {
  cfg?: unknown;
  workFrontId?: string | null;
  telefoneFrente?: string | null;
}) {
  const { cfg, workFrontId = null, telefoneFrente = null } = opts;
  const docsFor = (name: string) => {
    if (name === 'configuracoes') {
      return cfg === undefined ? [] : [{ data: () => cfg }];
    }
    if (name === 'allocations') {
      return workFrontId == null ? [] : [{ data: () => ({ workFrontId }) }];
    }
    if (name === 'work-fronts') {
      return telefoneFrente == null
        ? []
        : [{ data: () => ({ telefone: telefoneFrente }) }];
    }
    throw new Error('coleção inesperada: ' + name);
  };
  const db = {
    collection: jest.fn((name: string) => ({
      where: jest.fn(() => ({
        get: async () => ({ docs: docsFor(name) }),
      })),
    })),
  };
  return { getFirestore: () => db } as any;
}

function makeWhatsapp(conectado = true) {
  return {
    estaConectado: jest.fn(() => conectado),
    enviarMensagem: jest.fn().mockResolvedValue(undefined),
    enviarImagem: jest.fn().mockResolvedValue(undefined),
  };
}

function makeMail() {
  return {
    habilitado: jest.fn(() => false),
    enviar: jest.fn().mockResolvedValue({ ok: true }),
  };
}

const doc: DadosEmergenciaWhats = {
  prefeituraId: 'pref1',
  severity: 'critical',
  idMaquina: 'v1',
  tipoFalha: 'Hidráulica',
  descricao: 'Vazamento',
  operadorNome: 'João',
  dataHoraIso: '2026-06-09T12:00:00.000Z',
};

describe('EmergenciesService.notificarWhatsApp', () => {
  it('notifica empresa E frente alocada quando o toggle está ligado', async () => {
    const whatsapp = makeWhatsapp();
    const firebase = makeFirebase({
      cfg: {
        alertas: { notificacaoWhatsapp: true },
        empresa: { whatsappNumero: '67 99999-9999' },
      },
      workFrontId: 'wf1',
      telefoneFrente: '+5511988887777',
    });
    const svc = new EmergenciesService(
      firebase,
      whatsapp as any,
      makeMail() as any,
    );

    await svc.notificarWhatsApp(doc);

    expect(whatsapp.enviarMensagem).toHaveBeenCalledTimes(2);
    const numeros = whatsapp.enviarMensagem.mock.calls.map((c) => c[0]);
    expect(numeros).toEqual(['67 99999-9999', '+5511988887777']);
  });

  it('não notifica ninguém quando o toggle está desligado', async () => {
    const whatsapp = makeWhatsapp();
    const firebase = makeFirebase({
      cfg: {
        alertas: { notificacaoWhatsapp: false },
        empresa: { whatsappNumero: '67 99999-9999' },
      },
      workFrontId: 'wf1',
      telefoneFrente: '+5511988887777',
    });
    const svc = new EmergenciesService(
      firebase,
      whatsapp as any,
      makeMail() as any,
    );

    await svc.notificarWhatsApp(doc);

    expect(whatsapp.enviarMensagem).not.toHaveBeenCalled();
    expect(whatsapp.enviarImagem).not.toHaveBeenCalled();
  });

  it('deduplica quando empresa e frente são o mesmo número', async () => {
    const whatsapp = makeWhatsapp();
    const firebase = makeFirebase({
      cfg: {
        alertas: { notificacaoWhatsapp: true },
        empresa: { whatsappNumero: '67 99999-9999' },
      },
      workFrontId: 'wf1',
      telefoneFrente: '+5567999999999', // mesmo número em E.164
    });
    const svc = new EmergenciesService(
      firebase,
      whatsapp as any,
      makeMail() as any,
    );

    await svc.notificarWhatsApp(doc);

    expect(whatsapp.enviarMensagem).toHaveBeenCalledTimes(1);
  });

  it('notifica só a empresa quando o equipamento não tem frente alocada', async () => {
    const whatsapp = makeWhatsapp();
    const firebase = makeFirebase({
      cfg: {
        alertas: { notificacaoWhatsapp: true },
        empresa: { whatsappNumero: '67 99999-9999' },
      },
      workFrontId: null,
    });
    const svc = new EmergenciesService(
      firebase,
      whatsapp as any,
      makeMail() as any,
    );

    await svc.notificarWhatsApp(doc);

    expect(whatsapp.enviarMensagem).toHaveBeenCalledTimes(1);
    expect(whatsapp.enviarMensagem.mock.calls[0][0]).toBe('67 99999-9999');
  });

  it('não faz nada quando o WhatsApp está desconectado', async () => {
    const whatsapp = makeWhatsapp(false);
    const firebase = makeFirebase({
      cfg: {
        alertas: { notificacaoWhatsapp: true },
        empresa: { whatsappNumero: '67 99999-9999' },
      },
      workFrontId: 'wf1',
      telefoneFrente: '+5511988887777',
    });
    const svc = new EmergenciesService(
      firebase,
      whatsapp as any,
      makeMail() as any,
    );

    await svc.notificarWhatsApp(doc);

    expect(whatsapp.enviarMensagem).not.toHaveBeenCalled();
  });
});
