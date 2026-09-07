jest.mock('../../prisma/prisma.service', () => ({
  PrismaService: class PrismaService {},
}));

jest.mock('../../common/prisma/company-resolver', () => {
  const actual = jest.requireActual<
    typeof import('../../common/prisma/company-resolver')
  >('../../common/prisma/company-resolver');
  return { ...actual, resolverCompanyId: jest.fn() };
});

import { SolicitacoesPontoService } from './solicitacoes-ponto.service';
import { resolverCompanyId } from '../../common/prisma/company-resolver';
import type { NotificacoesService } from '../notificacoes/notificacoes.service';
import type { AbonosService } from '../abonos/abonos.service';

const resolveCompany = jest.mocked(resolverCompanyId);

// `listar` não chama nem notificações nem abonos: stubs vazios bastam.
const notificacoes = {} as NotificacoesService;
const abonos = {} as AbonosService;

function makePrisma() {
  const findMany = jest.fn();
  const prisma = {
    pontoSolicitacao: { findMany },
  };
  return {
    // Cast para o tipo do construtor (como em ponto.service.spec.ts): o
    // objeto plano não implementa PrismaService inteiro, só o que `listar`
    // usa. `findMany` fica exposto à parte para configurar/inspecionar o
    // mock sem perder a tipagem de jest.fn() no meio do caminho.
    prisma: prisma as unknown as ConstructorParameters<
      typeof SolicitacoesPontoService
    >[0],
    findMany,
  };
}

describe('SolicitacoesPontoService.listar', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resolveCompany.mockResolvedValue('uuid-1');
  });

  it('recorta por CPF quando o filtro traz cpf', async () => {
    const { prisma, findMany } = makePrisma();
    const service = new SolicitacoesPontoService(prisma, notificacoes, abonos);
    findMany.mockResolvedValue([]);

    await service.listar('pref-1', { cpf: '491.430.918-14' });

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { companyId: 'uuid-1', operatorCpf: '49143091814' },
      }),
    );
  });

  it('recorta por nome quando não há cpf', async () => {
    const { prisma, findMany } = makePrisma();
    const service = new SolicitacoesPontoService(prisma, notificacoes, abonos);
    findMany.mockResolvedValue([]);

    await service.listar('pref-1', { nome: '  Ana Souza ' });

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          companyId: 'uuid-1',
          operatorNome: { equals: 'Ana Souza', mode: 'insensitive' },
        },
      }),
    );
  });

  it('cpf ganha do nome quando os dois vêm', async () => {
    const { prisma, findMany } = makePrisma();
    const service = new SolicitacoesPontoService(prisma, notificacoes, abonos);
    findMany.mockResolvedValue([]);

    await service.listar('pref-1', { cpf: '49143091814', nome: 'Ana' });

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { companyId: 'uuid-1', operatorCpf: '49143091814' },
      }),
    );
  });

  it('sem filtro, devolve a empresa inteira como sempre devolveu', async () => {
    const { prisma, findMany } = makePrisma();
    const service = new SolicitacoesPontoService(prisma, notificacoes, abonos);
    findMany.mockResolvedValue([]);

    await service.listar('pref-1');

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { companyId: 'uuid-1' } }),
    );
  });
});
