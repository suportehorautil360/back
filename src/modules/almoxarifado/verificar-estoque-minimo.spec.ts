import { NotFoundException } from '@nestjs/common';

jest.mock('./compras/estoque-minimo', () => ({
  verificarReposicoesSemFalhar: jest.fn(async () => ({ criadas: 1, falhas: 0 })),
}));

import { AlmoxarifadoService } from './almoxarifado.service';
import { AlmoxarifadoModule } from './almoxarifado.module';
import { EstoqueMinimoAgendador } from './compras/estoque-minimo.agendador';
import { verificarReposicoesSemFalhar } from './compras/estoque-minimo';

const verificou = verificarReposicoesSemFalhar as jest.Mock;
const COMPANY = '11111111-1111-1111-1111-111111111111';
const OUTRA = '99999999-9999-9999-9999-999999999999';
const PECA = '55555555-5555-5555-5555-555555555555';

/**
 * A rota que o painel chama depois de mudar o mínimo ou o lote de reposição de
 * uma peça. O motor em si tem suíte própria (`compras/estoque-minimo.spec.ts`);
 * aqui se prova o ESCOPO: a peça é da empresa do gate, e os alvos são os
 * depósitos ativos dela em que a peça tem saldo.
 */
function prismaFalso(saldos: string[], pecaExiste = true) {
  const wheres: unknown[] = [];
  return {
    wheres,
    prisma: {
      peca: {
        findFirst: jest.fn(async ({ where }: { where: { id: string; companyId: string } }) =>
          pecaExiste && where.id === PECA && where.companyId === COMPANY ? { id: PECA } : null,
        ),
      },
      pecaSaldo: {
        findMany: jest.fn(async ({ where }: { where: unknown }) => {
          wheres.push(where);
          return saldos.map((depositoId) => ({ depositoId }));
        }),
      },
    },
  };
}

describe('verificarEstoqueMinimoDaPeca', () => {
  beforeEach(() => verificou.mockClear());

  it('confere cada depósito ativo em que a peça tem saldo', async () => {
    const { prisma, wheres } = prismaFalso(['dep-1', 'dep-2']);
    const servico = new AlmoxarifadoService(prisma as never);

    expect(await servico.verificarEstoqueMinimoDaPeca(COMPANY, PECA)).toEqual({ criadas: 1, falhas: 0 });

    expect(wheres).toEqual([{ pecaId: PECA, deposito: { companyId: COMPANY, ativo: true } }]);
    expect(verificou.mock.calls[0][1]).toEqual([
      { companyId: COMPANY, pecaId: PECA, depositoId: 'dep-1' },
      { companyId: COMPANY, pecaId: PECA, depositoId: 'dep-2' },
    ]);
  });

  it('peça sem saldo em depósito nenhum: nada a repor, sem chamar o motor', async () => {
    const { prisma } = prismaFalso([]);
    const servico = new AlmoxarifadoService(prisma as never);

    expect(await servico.verificarEstoqueMinimoDaPeca(COMPANY, PECA)).toEqual({ criadas: 0, falhas: 0 });
    expect(verificou).not.toHaveBeenCalled();
  });

  it('peça de outra empresa: 404 e nem chega a ler saldo', async () => {
    const { prisma } = prismaFalso(['dep-1']);
    const servico = new AlmoxarifadoService(prisma as never);

    await expect(servico.verificarEstoqueMinimoDaPeca(OUTRA, PECA)).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.pecaSaldo.findMany).not.toHaveBeenCalled();
    expect(verificou).not.toHaveBeenCalled();
  });
});

describe('AlmoxarifadoModule', () => {
  it('registra o agendador da varredura diária — sem provider, o cron das 7h nunca roda', () => {
    const providers = Reflect.getMetadata('providers', AlmoxarifadoModule) as unknown[];
    expect(providers).toContain(EstoqueMinimoAgendador);
  });
});
