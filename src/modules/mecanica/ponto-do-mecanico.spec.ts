/**
 * A batida de ponto do mecânico pelo app.
 *
 * Ele já batia pelo painel web. O que estes testes prendem é o que muda por
 * ser offline: o horário é o do APARELHO, a chave de idempotência vale como
 * identidade da batida, e nenhuma dessas duas pode falhar em silêncio —
 * batida duplicada no ledger é registro legal errado, e horário carimbado na
 * chegada rouba as horas de quem trabalhou.
 */
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';

import { MecanicaService } from './mecanica.service';

const PAINEL = {
  companyId: 'c-1',
  operatorId: 'op-1',
} as never;

const OPERADOR = {
  id: 'op-1',
  nome: 'Pedro Oliveira',
  cpf: '12345678901',
  baterPonto: true,
};

type Opcoes = {
  operator?: Record<string, unknown> | null;
  porChave?: Record<string, unknown> | null;
  doMesmoTipo?: Record<string, unknown> | null;
};

function servico(opcoes: Opcoes = {}) {
  const criados: Record<string, unknown>[] = [];

  const findFirstPonto = jest
    .fn()
    // 1ª chamada: busca pela chave de idempotência.
    .mockResolvedValueOnce(opcoes.porChave ?? null)
    // 2ª: busca por tipo no mesmo dia.
    .mockResolvedValueOnce(opcoes.doMesmoTipo ?? null);

  const prisma = {
    operator: {
      findFirst: jest.fn(() =>
        Promise.resolve(
          opcoes.operator === undefined ? OPERADOR : opcoes.operator,
        ),
      ),
    },
    pontoRegistro: { findFirst: findFirstPonto, findMany: jest.fn() },
    $transaction: jest.fn((fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        pontoNsrCounter: {
          upsert: jest.fn(),
          findUniqueOrThrow: jest.fn(() =>
            Promise.resolve({ ultimo: 41, ultimoHash: 'hash-anterior' }),
          ),
          update: jest.fn(),
        },
        $executeRawUnsafe: jest.fn(),
        pontoRegistro: {
          create: jest.fn(({ data }: { data: Record<string, unknown> }) => {
            criados.push(data);
            return Promise.resolve(data);
          }),
        },
      }),
    ),
  };

  const uploads = {
    uploadSelfiePontoPorCompany: jest.fn(() =>
      Promise.resolve('c-1/2026/09/selfie.jpg'),
    ),
  };

  return {
    servico: new MecanicaService(prisma as never, uploads as never),
    prisma,
    uploads,
    criados,
    findFirstPonto,
  };
}

const SELFIE = { buffer: Buffer.from('x'), mimetype: 'image/jpeg' };
const AS_SETE = '2026-09-10T10:00:00.000Z';

describe('MecanicaService.baterPonto', () => {
  it('grava com o horário do APARELHO, não o do servidor', async () => {
    const { servico: s, criados } = servico();

    await s.baterPonto(
      PAINEL,
      { tipo: 'entrada', timestampOriginal: AS_SETE },
      SELFIE,
      'chave-1',
    );

    expect(criados[0].timestampOriginal).toEqual(new Date(AS_SETE));
  });

  it('a chave de idempotência vira a identidade da batida', async () => {
    const { servico: s, criados } = servico();

    await s.baterPonto(
      PAINEL,
      { tipo: 'entrada', timestampOriginal: AS_SETE },
      SELFIE,
      'chave-1',
    );

    expect(criados[0].legacyId).toBe('chave-1');
  });

  // A fila do app reenvia com a mesma chave depois de uma resposta perdida.
  // Uma batida duplicada no ledger é registro legal errado que não se apaga.
  it('reenvio da mesma chave devolve a batida original, sem criar outra', async () => {
    const original = { id: 'p-1', nsr: 42, legacyId: 'chave-1' };
    const { servico: s, criados, uploads } = servico({ porChave: original });

    const r = await s.baterPonto(
      PAINEL,
      { tipo: 'entrada', timestampOriginal: AS_SETE },
      SELFIE,
      'chave-1',
    );

    expect(r).toBe(original);
    expect(criados).toHaveLength(0);
    // Nem sobe a selfie de novo: seria um arquivo órfão por reenvio.
    expect(uploads.uploadSelfiePontoPorCompany).not.toHaveBeenCalled();
  });

  // Devolver, e não recusar: o app que tentou de novo precisa saber que está
  // registrado — não que falhou.
  it('mesmo tipo já batido no dia devolve o que existe', async () => {
    const existente = { id: 'p-1', nsr: 42, tipo: 'entrada' };
    const { servico: s, criados } = servico({ doMesmoTipo: existente });

    const r = await s.baterPonto(
      PAINEL,
      { tipo: 'entrada', timestampOriginal: AS_SETE },
      SELFIE,
      'chave-2',
    );

    expect(r).toBe(existente);
    expect(criados).toHaveLength(0);
  });

  it('sela com o NSR seguinte e encadeia no hash anterior', async () => {
    const { servico: s, criados } = servico();

    await s.baterPonto(
      PAINEL,
      { tipo: 'entrada', timestampOriginal: AS_SETE },
      SELFIE,
      'chave-1',
    );

    expect(criados[0].nsr).toBe(42);
    expect(criados[0].hashAnterior).toBe('hash-anterior');
    expect(String(criados[0].hash)).toHaveLength(64);
  });

  // Mesma condição do painel: quem não bate ponto lá não bate aqui. Um
  // caminho mais frouxo que o outro seria porta lateral.
  it('recusa quem o cadastro diz que não bate ponto', async () => {
    const { servico: s } = servico({
      operator: { ...OPERADOR, baterPonto: false },
    });

    await expect(
      s.baterPonto(
        PAINEL,
        { tipo: 'entrada', timestampOriginal: AS_SETE },
        SELFIE,
        'chave-1',
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('recusa funcionário de outra empresa ou inativo', async () => {
    const { servico: s } = servico({ operator: null });

    await expect(
      s.baterPonto(
        PAINEL,
        { tipo: 'entrada', timestampOriginal: AS_SETE },
        SELFIE,
        'chave-1',
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('recusa tipo que não existe na folha do dia', async () => {
    const { servico: s } = servico();

    await expect(
      s.baterPonto(
        PAINEL,
        { tipo: 'cafezinho', timestampOriginal: AS_SETE },
        SELFIE,
        'chave-1',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('recusa horário ilegível em vez de gravar Invalid Date', async () => {
    const { servico: s } = servico();

    await expect(
      s.baterPonto(
        PAINEL,
        { tipo: 'entrada', timestampOriginal: 'ontem de manhã' },
        SELFIE,
        'chave-1',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  // A selfie é condição da batida no painel; aqui também.
  it('recusa batida sem selfie', async () => {
    const { servico: s } = servico();

    await expect(
      s.baterPonto(
        PAINEL,
        { tipo: 'entrada', timestampOriginal: AS_SETE },
        undefined,
        'chave-1',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('arredonda a precisão do GPS — a coluna é inteira', async () => {
    const { servico: s, criados } = servico();

    await s.baterPonto(
      PAINEL,
      {
        tipo: 'entrada',
        timestampOriginal: AS_SETE,
        latitude: -22.4,
        longitude: -47.5,
        precisaoMetros: 12.7,
      },
      SELFIE,
      'chave-1',
    );

    expect(criados[0].precisaoMetros).toBe(13);
  });

  it('sem GPS grava nulo, não zero — zero é uma coordenada de verdade', async () => {
    const { servico: s, criados } = servico();

    await s.baterPonto(
      PAINEL,
      { tipo: 'entrada', timestampOriginal: AS_SETE },
      SELFIE,
      'chave-1',
    );

    expect(criados[0].latitude).toBeNull();
    expect(criados[0].precisaoMetros).toBeNull();
  });
});

describe('MecanicaService.pontoDoDia', () => {
  it('recorta o dia pedido, só as batidas originais daquele funcionário', async () => {
    const { servico: s, prisma } = servico();

    await s.pontoDoDia(PAINEL, '2026-09-10');

    const where = prisma.pontoRegistro.findMany.mock.calls[0][0].where;
    expect(where.operatorId).toBe('op-1');
    expect(where.companyId).toBe('c-1');
    expect(where.registro).toBe('original');
    expect(where.timestampOriginal.gte).toEqual(
      new Date('2026-09-10T00:00:00.000Z'),
    );
  });

  // Data ilegível cai em hoje em vez de lançar: a tela do app não pode ficar
  // sem a folha do dia por causa de um parâmetro torto.
  it('dia malformado cai em hoje', async () => {
    const { servico: s, prisma } = servico();

    await s.pontoDoDia(PAINEL, 'ontem');

    const hoje = new Date().toISOString().slice(0, 10);
    expect(
      prisma.pontoRegistro.findMany.mock.calls[0][0].where.timestampOriginal.gte,
    ).toEqual(new Date(`${hoje}T00:00:00.000Z`));
  });
});
