import { NotFoundException } from '@nestjs/common';
import { registrarAuditoriaSuprimentos } from './auditoria';

const COMPANY = '11111111-1111-1111-1111-111111111111';
const OUTRA = '22222222-2222-2222-2222-222222222222';

/** Fake que FILTRA por id e empresa — um mock que sempre achasse o usuário não provaria o escopo. */
function txFalso() {
  const usuarios = [
    { id: 'u-1', companyId: COMPANY, name: 'Compradora', email: 'compras@empresa.com' },
    { id: 'u-outra', companyId: OUTRA, name: 'De fora', email: 'fora@outra.com' },
  ];
  return {
    companyUser: {
      findFirst: jest.fn(async ({ where }: { where: { id: string; companyId?: string } }) =>
        usuarios.find((u) => u.id === where.id && (where.companyId === undefined || u.companyId === where.companyId)) ?? null,
      ),
    },
    pontoAuditoria: { create: jest.fn(async () => ({})) },
  };
}

describe('registrarAuditoriaSuprimentos', () => {
  it('congela nome e e-mail do ator no instante do ato', async () => {
    const tx = txFalso();
    await registrarAuditoriaSuprimentos(tx as never, {
      companyId: COMPANY, acao: 'ordem_compra.aprovar', alvoTipo: 'suprimentos.ordem_compra',
      alvoId: 'oc-1', atorCompanyUserId: 'u-1', motivo: null, depois: { status: 'emitida' },
    });
    expect(tx.pontoAuditoria.create).toHaveBeenCalledWith({
      data: {
        companyId: COMPANY, acao: 'ordem_compra.aprovar', alvoTipo: 'suprimentos.ordem_compra',
        alvoId: 'oc-1', atorId: 'u-1', atorNome: 'Compradora', atorEmail: 'compras@empresa.com',
        motivo: null, depois: { status: 'emitida' },
      },
    });
  });

  it('usuário de OUTRA empresa não assina ato nenhum — recusa sem gravar', async () => {
    const tx = txFalso();
    await expect(registrarAuditoriaSuprimentos(tx as never, {
      companyId: COMPANY, acao: 'ordem_compra.aprovar', alvoTipo: 'suprimentos.ordem_compra',
      alvoId: 'oc-1', atorCompanyUserId: 'u-outra',
    })).rejects.toBeInstanceOf(NotFoundException);
    expect(tx.pontoAuditoria.create).not.toHaveBeenCalled();
  });

  it('ato do sistema grava ator nulo com nome "Sistema"', async () => {
    const tx = txFalso();
    await registrarAuditoriaSuprimentos(tx as never, {
      companyId: COMPANY, acao: 'solicitacao_compra.criar_automatica',
      alvoTipo: 'suprimentos.solicitacao_compra', alvoId: 'sc-1', atorCompanyUserId: null,
    });
    const data = (tx.pontoAuditoria.create.mock.calls[0] as unknown as [{ data: Record<string, unknown> }])[0].data;
    expect(data).toMatchObject({ atorId: null, atorNome: 'Sistema', atorEmail: '' });
    expect(tx.companyUser.findFirst).not.toHaveBeenCalled();
    // "Não se aplica" é a AUSÊNCIA da chave, não um JSON nulo.
    expect('antes' in data).toBe(false);
    expect('depois' in data).toBe(false);
  });
});
