/**
 * A O.S. preventiva virando inspeção preenchível.
 *
 * O relato da ordem já trazia as linhas do ciclo em texto corrido: dava para
 * ler o que fazer, não para registrar o que foi feito. O que se prende aqui é
 * o caminho da matriz até o documento — e, sobretudo, as recusas: cada uma
 * delas é um jeito de o mecânico acabar com um documento que não corresponde
 * à revisão que ele executou.
 */
import { BadRequestException, ForbiddenException } from '@nestjs/common';

import { MecanicaService } from './mecanica.service';

const PAINEL = {
  companyId: 'c-1',
  operatorId: 'op-1',
  companyUserId: 'cu-1',
} as never;

const CATEGORIAS = [
  {
    id: 'cat-retro',
    nome: 'retro',
    ciclos: [{ id: 'c2', titulo: 'Ciclo 2 (500h / 20.000km)' }],
    linhas: [
      { id: 'l-oleo', item: 'Óleo do Motor', acoes: { c2: 'inspecionar' } },
      { id: 'l-na', item: 'Esteira', acoes: { c2: 'na' } },
    ],
  },
];

const OS_PREVENTIVA = {
  id: 'os-1',
  tipoOs: 'V',
  categoriaPlanoId: 'cat-retro',
  cicloId: 'c2',
  equipmentId: 'eq-1',
  equipment: { modelo: '580N', tipo: 'Retroescavadeira' },
};

function servico(
  opcoes: {
    os?: Record<string, unknown> | null;
    execucaoAberta?: Record<string, unknown> | null;
    modeloExistente?: Record<string, unknown> | null;
    plano?: Record<string, unknown> | null;
  } = {},
) {
  const criarExecucao = jest.fn((args: { data: unknown }) =>
    Promise.resolve({ id: 'ex-nova', ...(args.data as object) }),
  );
  const criarModelo = jest.fn((args: { data: unknown }) =>
    Promise.resolve({ id: 'mod-novo', ...(args.data as object) }),
  );
  const atualizarModelo = jest.fn(() => Promise.resolve({ id: 'mod-velho' }));
  const acharPlano = jest.fn(() =>
    Promise.resolve(
      opcoes.plano === undefined ? { categorias: CATEGORIAS } : opcoes.plano,
    ),
  );

  const prisma = {
    serviceOrder: {
      findFirst: jest.fn(() =>
        Promise.resolve(opcoes.os === undefined ? OS_PREVENTIVA : opcoes.os),
      ),
    },
    checklistExecucao: {
      findFirst: jest.fn(() => Promise.resolve(opcoes.execucaoAberta ?? null)),
      create: criarExecucao,
    },
    checklistModelo: {
      findFirst: jest.fn(() => Promise.resolve(opcoes.modeloExistente ?? null)),
      create: criarModelo,
      update: atualizarModelo,
    },
    planoPreventivo: { findUnique: acharPlano },
    $transaction: (fn: (tx: unknown) => unknown) => fn(prisma),
  };

  return {
    servico: new MecanicaService(prisma as never, {} as never),
    prisma,
    criarExecucao,
    criarModelo,
    atualizarModelo,
    acharPlano,
  };
}

describe('MecanicaService.abrirInspecaoDaPreventiva', () => {
  it('monta o documento com as linhas do ciclo e prende à ordem', async () => {
    const { servico: s, criarExecucao, criarModelo } = servico();

    await s.abrirInspecaoDaPreventiva(PAINEL, 'os-1');

    const grupos = criarModelo.mock.calls[0][0].data.grupos as {
      itens: { id: string }[];
    }[];
    // "na" não é trabalho do ciclo e não pode virar item na máquina.
    expect(grupos[0].itens.map((i) => i.id)).toEqual(['l-oleo']);

    expect(criarExecucao.mock.calls[0][0].data).toMatchObject({
      companyId: 'c-1',
      serviceOrderId: 'os-1',
      equipmentId: 'eq-1',
      operatorId: 'op-1',
    });
  });

  /**
   * O botão fica num aparelho que perde sinal e recebe toque repetido. Duas
   * inspeções abertas para a mesma O.S. dividiriam as respostas em dois
   * documentos, e nenhum dos dois seria a revisão.
   */
  it('chamar de novo devolve a inspeção já aberta, sem criar outra', async () => {
    const { servico: s, criarExecucao, criarModelo } = servico({
      execucaoAberta: { id: 'ex-1', status: 'aberta' },
    });

    expect(await s.abrirInspecaoDaPreventiva(PAINEL, 'os-1')).toEqual({
      id: 'ex-1',
      status: 'aberta',
    });
    expect(criarExecucao).not.toHaveBeenCalled();
    expect(criarModelo).not.toHaveBeenCalled();
  });

  /**
   * Reusar o modelo pelo nome é o que mantém o histórico comparável: doze
   * revisões de 500h respondem ao mesmo documento, e dá para perguntar o que
   * vive reprovando naquele item.
   */
  it('reusa o modelo do ciclo e o atualiza com a matriz de hoje', async () => {
    const { servico: s, criarModelo, atualizarModelo } = servico({
      modeloExistente: { id: 'mod-velho', nome: 'PREVENTIVA …' },
    });

    await s.abrirInspecaoDaPreventiva(PAINEL, 'os-1');

    expect(criarModelo).not.toHaveBeenCalled();
    // O plano muda em Engenharia; a inspeção de amanhã é a matriz de amanhã.
    expect(atualizarModelo.mock.calls[0][0].data.grupos).toBeDefined();
  });

  it('o modelo nasce preso à ordem — não vira inspeção avulsa sem ciclo', async () => {
    const { servico: s, criarModelo } = servico();
    await s.abrirInspecaoDaPreventiva(PAINEL, 'os-1');
    expect(criarModelo.mock.calls[0][0].data.exigeOs).toBe('exige_os');
  });

  // `P` é PREDITIVA. A troca entre as duas já custou um bloco de tela que
  // nunca aparecia.
  it('recusa O.S. que não é preventiva', async () => {
    const { servico: s } = servico({ os: { ...OS_PREVENTIVA, tipoOs: 'C' } });

    await expect(
      s.abrirInspecaoDaPreventiva(PAINEL, 'os-1'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('recusa preventiva aberta sem categoria e ciclo', async () => {
    const { servico: s } = servico({
      os: { ...OS_PREVENTIVA, categoriaPlanoId: null, cicloId: null },
    });

    await expect(
      s.abrirInspecaoDaPreventiva(PAINEL, 'os-1'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  /**
   * Acontece quando a matriz mudou em Engenharia depois de a ordem ser
   * aberta. Documento vazio é pior que recusa: o mecânico concluiria uma
   * inspeção de zero itens e ela contaria como revisão feita.
   */
  it('recusa quando o ciclo não tem nenhum item para inspecionar', async () => {
    const { servico: s } = servico({ plano: { categorias: [] } });

    await expect(
      s.abrirInspecaoDaPreventiva(PAINEL, 'os-1'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('gestor sem Operator não abre inspeção', async () => {
    const { servico: s } = servico();

    await expect(
      s.abrirInspecaoDaPreventiva(
        { companyId: 'c-1', operatorId: null } as never,
        'os-1',
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  /** Mesma ordem do painel: o plano do modelo da máquina, e o "Geral" atrás. */
  it('procura o plano do modelo da máquina antes do Geral', async () => {
    const { servico: s, acharPlano } = servico();

    await s.abrirInspecaoDaPreventiva(PAINEL, 'os-1');

    expect(acharPlano.mock.calls[0][0].where.companyId_modelo).toEqual({
      companyId: 'c-1',
      modelo: '580N',
    });
  });
});
