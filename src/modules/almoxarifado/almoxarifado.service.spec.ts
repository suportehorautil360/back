import { ConflictException } from '@nestjs/common';
import { AlmoxarifadoService } from './almoxarifado.service';
import { Prisma } from '../../prisma/generated/client';

const COMPANY = '11111111-1111-1111-1111-111111111111';

function montar(pecas: unknown[]) {
  const prisma = {
    peca: {
      findMany: jest.fn().mockResolvedValue(pecas),
    },
  };
  return {
    servico: new AlmoxarifadoService(prisma as never),
    prisma,
  };
}

describe('buscarPorCodigo', () => {
  it('procura no código interno E no do fabricante, numa consulta só', async () => {
    const { servico, prisma } = montar([]);
    await servico.buscarPorCodigo(COMPANY, ' alm-000123 ');

    const where = prisma.peca.findMany.mock.calls[0][0].where;
    expect(where.companyId).toBe(COMPANY);
    expect(where.OR).toEqual([
      { codigoInterno: 'ALM-000123' },
      { codigoFabricante: 'ALM-000123' },
    ]);
    expect(where.ativo).toBe(true);
    expect(prisma.peca.findMany.mock.calls[0][0].take).toBe(20);
  });

  it('devolve lista, não um item: part number repete entre marcas', async () => {
    const { servico } = montar([{ id: 'a' }, { id: 'b' }]);
    await expect(servico.buscarPorCodigo(COMPANY, '32/925994')).resolves.toHaveLength(2);
  });

  it('peça desativada não aparece no balcão', () => {
    // Item fora de linha continua no catálogo pelo histórico de movimento,
    // mas oferecê-lo a quem está separando um kit é entregar peça errada.
    const { servico, prisma } = montar([]);
    return servico.buscarPorCodigo(COMPANY, 'ALM-000001').then(() => {
      expect(prisma.peca.findMany.mock.calls[0][0].where.ativo).toBe(true);
    });
  });

  it('código vazio não consulta o banco e devolve vazio', async () => {
    // Leitor de balcão dispara Enter sozinho. Sem esta guarda, cada Enter
    // acidental vira um SELECT sem WHERE útil.
    const { servico, prisma } = montar([]);
    await expect(servico.buscarPorCodigo(COMPANY, '   ')).resolves.toEqual([]);
    expect(prisma.peca.findMany).not.toHaveBeenCalled();
  });
});

const AUTOR = '44444444-4444-4444-4444-444444444444';

/**
 * Fabrica o erro de colisão no índice único parcial
 * `inventarios_uma_aberta_por_deposito` (migration
 * `20260917100000_inventario_ciclico`) — achado Important I1 da revisão
 * final. Mesmo formato de `erroDeRequisicaoJaAberta` em `reserva.spec.ts`.
 */
function erroDeContagemJaAberta(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002', clientVersion: '7.9.1', meta: { target: ['deposito_id'] },
  });
}

/**
 * `inventario.findFirst` (a checagem de aplicação) devolve `null` de
 * propósito — é o retrato de uma corrida de verdade: a OUTRA transação já
 * tem uma contagem aberta no depósito, mas esta ainda não vê (TOCTOU sob
 * READ COMMITTED). É por isso que o `INSERT` (`inventario.create`) é quem
 * esbarra no índice, não o `findFirst`.
 */
function montarAbrirContagem() {
  const tx = {
    deposito: { findFirst: jest.fn().mockResolvedValue({ id: 'dep-1' }) },
    inventario: {
      findFirst: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn(async () => {
        throw erroDeContagemJaAberta();
      }),
    },
    peca: { findMany: jest.fn().mockResolvedValue([{ id: 'p-1' }]) },
  };
  const prisma = {
    $transaction: jest.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
  };
  return { prisma, tx };
}

describe('abrirContagem', () => {
  it('achado Important I1 da revisão final: colisão no índice de contagem-única-por-depósito vira ConflictException IMEDIATA, sem retry, e sem 500 cru', async () => {
    const { prisma, tx } = montarAbrirContagem();
    const servico = new AlmoxarifadoService(prisma as never);

    await expect(
      servico.abrirContagem({
        companyId: COMPANY, depositoId: 'dep-1', pecaIds: ['p-1'], autorCompanyUserId: AUTOR,
      }),
    ).rejects.toThrow(ConflictException);
    // NÃO retentado — uma tentativa só, sem gastar as
    // MAX_TENTATIVAS_CONCORRENCIA travando à toa: não é contenção, é a mesma
    // regra de negócio da checagem de aplicação, só que pega no banco.
    expect(tx.inventario.create).toHaveBeenCalledTimes(1);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('erro que não é a colisão do índice de contagem propaga sem virar ConflictException de contagem', async () => {
    const { prisma, tx } = montarAbrirContagem();
    tx.inventario.create = jest.fn(async () => {
      throw new Error('erro qualquer, sem relação com o índice');
    });
    const servico = new AlmoxarifadoService(prisma as never);

    await expect(
      servico.abrirContagem({
        companyId: COMPANY, depositoId: 'dep-1', pecaIds: ['p-1'], autorCompanyUserId: AUTOR,
      }),
    ).rejects.toThrow('erro qualquer, sem relação com o índice');
  });
});
