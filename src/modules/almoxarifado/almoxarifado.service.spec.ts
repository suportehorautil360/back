import { AlmoxarifadoService } from './almoxarifado.service';

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
