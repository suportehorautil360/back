import { notificarKitCompleto, notificarOsLiberada } from './almoxarifado-notificacoes';

const COMPANY = '11111111-1111-1111-1111-111111111111';

function tx() {
  return {
    company: { findUnique: jest.fn().mockResolvedValue({ legacyId: 'leg-1' }) },
    operator: { findFirst: jest.fn().mockResolvedValue({ companyUserId: 'user-mec' }) },
    equipmentProgramador: { findFirst: jest.fn().mockResolvedValue({ companyUserId: 'user-prog' }) },
    notificacao: { createMany: jest.fn().mockResolvedValue({ count: 1 }) },
  };
}

describe('notificarOsLiberada', () => {
  it('avisa mecânico E programador, sem repetir quando são a mesma pessoa', async () => {
    const t = tx();
    t.equipmentProgramador.findFirst.mockResolvedValue({ companyUserId: 'user-mec' });
    await notificarOsLiberada(t as never, {
      companyId: COMPANY, serviceOrderId: 'os-1', protocolo: 'OS-2026-047',
      equipmentNome: 'ESC-014', responsavelOperatorId: 'op-1', equipmentId: 'eq-1',
      local: 'Almoxarifado Central',
    });
    const linhas = t.notificacao.createMany.mock.calls[0][0].data;
    expect(linhas).toHaveLength(1);
  });

  it('a mensagem diz onde retirar — sem isso o mecânico não sabe para onde ir', async () => {
    const t = tx();
    await notificarOsLiberada(t as never, {
      companyId: COMPANY, serviceOrderId: 'os-1', protocolo: 'OS-2026-047',
      equipmentNome: 'ESC-014', responsavelOperatorId: 'op-1', equipmentId: 'eq-1',
      local: 'Almoxarifado Central',
    });
    const linha = t.notificacao.createMany.mock.calls[0][0].data[0];
    expect(linha.mensagem).toContain('Almoxarifado Central');
    expect(linha.mensagem).toContain('ESC-014');
    expect(linha.referenciaTipo).toBe('service_order');
  });

  it('OS sem mecânico e sem programador não grava nada, em vez de quebrar', async () => {
    const t = tx();
    t.operator.findFirst.mockResolvedValue(null);
    t.equipmentProgramador.findFirst.mockResolvedValue(null);
    await notificarOsLiberada(t as never, {
      companyId: COMPANY, serviceOrderId: 'os-1', protocolo: 'OS-2026-047',
      equipmentNome: 'ESC-014', responsavelOperatorId: null, equipmentId: 'eq-1',
      local: 'Almoxarifado Central',
    });
    expect(t.notificacao.createMany).not.toHaveBeenCalled();
  });
});

describe('notificarKitCompleto', () => {
  it('avisa quem tem acesso ao almoxarifado, citando a OS', async () => {
    const t = tx();
    await notificarKitCompleto(t as never, {
      companyId: COMPANY, requisicaoId: 'req-1', numero: 'REQ-2026-001',
      protocolo: 'OS-2026-047', destinatarios: ['user-almox'],
    });
    const linha = t.notificacao.createMany.mock.calls[0][0].data[0];
    expect(linha.destinatarioId).toBe('user-almox');
    expect(linha.mensagem).toContain('REQ-2026-001');
    expect(linha.referenciaTipo).toBe('requisicao_material');
  });
});
