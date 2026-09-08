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

  // Achado da revisão: `?cpf=` presente e vazio caía no mesmo ramo de "sem
  // filtro" e devolvia a empresa inteira. Quem PEDIU recorte (cpf e/ou nome
  // presentes na query, ainda que vazios) e não deu identidade aproveitável
  // tem que receber vazio, nunca a lista inteira — é o vazamento que esta
  // tarefa existe para fechar.
  it('cpf vazio na query devolve vazio e não consulta o banco', async () => {
    const { prisma, findMany } = makePrisma();
    const service = new SolicitacoesPontoService(prisma, notificacoes, abonos);

    const resultado = await service.listar('pref-1', { cpf: '' });

    expect(resultado).toEqual({
      data: [],
      message: 'Solicitações carregadas.',
    });
    expect(findMany).not.toHaveBeenCalled();
  });

  it('nome vazio ou só espaços na query devolve vazio e não consulta o banco', async () => {
    const { prisma, findMany } = makePrisma();
    const service = new SolicitacoesPontoService(prisma, notificacoes, abonos);

    const resultado = await service.listar('pref-1', { nome: '   ' });

    expect(resultado).toEqual({
      data: [],
      message: 'Solicitações carregadas.',
    });
    expect(findMany).not.toHaveBeenCalled();
  });

  it('cpf sem nenhum dígito devolve vazio e não consulta o banco', async () => {
    const { prisma, findMany } = makePrisma();
    const service = new SolicitacoesPontoService(prisma, notificacoes, abonos);

    const resultado = await service.listar('pref-1', { cpf: 'abc' });

    expect(resultado).toEqual({
      data: [],
      message: 'Solicitações carregadas.',
    });
    expect(findMany).not.toHaveBeenCalled();
  });
});

describe('SolicitacoesPontoService.aprovar — corrigir horário', () => {
  const ALVO = {
    id: 'pk-da-batida',
    legacyId: 'id-do-aparelho',
    nsr: 7,
    tipo: 'entrada',
    timestampOriginal: new Date('2026-09-07T11:05:00.000Z'),
    operatorId: 'op-1',
    operatorNome: 'Ana Souza',
    operatorCpf: '49143091814',
  };

  const SOLICITACAO = {
    id: 'sol-1',
    legacyId: 'sol-1',
    companyId: 'uuid-1',
    operatorId: 'op-1',
    operatorNome: 'Ana Souza',
    operatorCpf: '49143091814',
    tipo: 'corrigir',
    status: 'pendente',
    batidaId: 'id-do-aparelho',
    data: null,
    timestampOriginal: new Date('2026-09-07T11:00:00.000Z'),
    tipoBatida: null,
    observacao: 'Cheguei 8h, marquei 8h05',
    anexoDataUrl: null,
    anexoNome: null,
    motivoReprovacao: null,
    createdAt: new Date('2026-09-07T12:00:00.000Z'),
    updatedAt: new Date('2026-09-07T12:00:00.000Z'),
  };

  function prismaParaAprovar() {
    const criados: Record<string, unknown>[] = [];
    const tx = {
      pontoNsrCounter: {
        upsert: jest.fn(),
        update: jest.fn(),
        findUniqueOrThrow: jest
          .fn()
          .mockResolvedValue({ ultimo: 10, ultimoHash: 'h10' }),
      },
      pontoRegistro: {
        create: jest.fn((args: { data: Record<string, unknown> }) => {
          criados.push(args.data);
          return Promise.resolve(args.data);
        }),
        findFirst: jest.fn().mockResolvedValue(null),
      },
      $executeRaw: jest.fn(),
      $queryRaw: jest.fn().mockResolvedValue([{ ultimo: 10, ultimoHash: 'h10' }]),
    };
    const prisma = {
      pontoSolicitacao: {
        findFirst: jest.fn().mockResolvedValue(SOLICITACAO),
        // Devolve uma LINHA, não os argumentos: `aprovar` passa o retorno por
        // `mapSolicitacaoRow`, que lê `createdAt.toISOString()`.
        update: jest.fn(() =>
          Promise.resolve({ ...SOLICITACAO, status: 'aprovado' }),
        ),
      },
      company: {
        findUnique: jest.fn().mockResolvedValue({ legacyId: 'prefeitura-1' }),
      },
      pontoRegistro: { findFirst: jest.fn().mockResolvedValue(ALVO) },
      $transaction: jest.fn((fn: (t: typeof tx) => unknown) => fn(tx)),
    };
    return { prisma, tx, criados };
  }

  beforeEach(() => {
    jest.clearAllMocks();
    resolveCompany.mockResolvedValue('uuid-1');
  });

  it('acha a batida alvo pelo id do APARELHO, não só pela PK', async () => {
    // O aparelho conhece o próprio id (que virou `legacyId` aqui) e nunca viu
    // a PK. Procurar só por `id` faria toda correção pedida pelo app cair no
    // vazio, e a aprovação passaria em silêncio sem corrigir nada.
    const { prisma } = prismaParaAprovar();
    const service = new SolicitacoesPontoService(
      prisma as unknown as ConstructorParameters<typeof SolicitacoesPontoService>[0],
      notificacoes,
      abonos,
    );

    await service.aprovar('sol-1');

    expect(prisma.pontoRegistro.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: [{ id: 'id-do-aparelho' }, { legacyId: 'id-do-aparelho' }],
        }),
      }),
    );
  });

  it('grava um ajuste APLICADO mirando o NSR da original, com o horário novo', async () => {
    // É o que `resolverLedger` lê para trocar o horário oficial e devolver
    // `horarioAnterior`. Sem `refNsr` o ajuste vira batida solta e o dia passa
    // a ter DUAS entradas; sem `aplicado` ele fica pendente para sempre.
    const { prisma, criados } = prismaParaAprovar();
    const service = new SolicitacoesPontoService(
      prisma as unknown as ConstructorParameters<typeof SolicitacoesPontoService>[0],
      notificacoes,
      abonos,
    );

    await service.aprovar('sol-1');

    expect(criados).toHaveLength(1);
    expect(criados[0]).toMatchObject({
      registro: 'ajuste',
      refNsr: 7,
      refId: 'id-do-aparelho',
      aplicado: true,
      tipo: 'entrada',
      timestampOriginal: new Date('2026-09-07T11:00:00.000Z'),
      operatorNome: 'Ana Souza',
      operatorCpf: '49143091814',
    });
  });

  it('não toca no ledger quando a batida alvo não existe', async () => {
    // Batida de outra empresa, ou apagada: aprovar não pode selar um ajuste
    // que mira o nada — ele viraria uma batida extra no dia.
    const { prisma, criados } = prismaParaAprovar();
    prisma.pontoRegistro.findFirst.mockResolvedValue(null);
    const service = new SolicitacoesPontoService(
      prisma as unknown as ConstructorParameters<typeof SolicitacoesPontoService>[0],
      notificacoes,
      abonos,
    );

    await service.aprovar('sol-1');

    expect(criados).toHaveLength(0);
  });
});
