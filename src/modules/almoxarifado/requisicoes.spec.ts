import { NotFoundException } from '@nestjs/common';
import { AlmoxarifadoService } from './almoxarifado.service';

const COMPANY = '11111111-1111-1111-1111-111111111111';
const OUTRA = '22222222-2222-2222-2222-222222222222';

function montar(requisicoes: unknown[], uma: unknown = null) {
  const prisma = {
    requisicaoMaterial: {
      findMany: jest.fn().mockResolvedValue(requisicoes),
      findFirst: jest.fn().mockResolvedValue(uma),
    },
  };
  return { servico: new AlmoxarifadoService(prisma as never), prisma };
}

describe('listarRequisicoes', () => {
  it('escopa por empresa e ordena a fila pela mais antiga primeiro', async () => {
    // A fila do almoxarife é FIFO: quem pediu primeiro espera menos.
    const { servico, prisma } = montar([]);
    await servico.listarRequisicoes(COMPANY);

    const args = prisma.requisicaoMaterial.findMany.mock.calls[0][0];
    expect(args.where.companyId).toBe(COMPANY);
    expect(args.orderBy).toEqual({ createdAt: 'asc' });
  });

  it('sem filtro, traz só o que ainda dá trabalho', async () => {
    // Entregue e cancelada saem da fila: a tela é o que fazer agora, não o
    // histórico. O histórico tem tela própria (Movimentos).
    const { servico, prisma } = montar([]);
    await servico.listarRequisicoes(COMPANY);

    expect(prisma.requisicaoMaterial.findMany.mock.calls[0][0].where.status).toEqual({
      in: ['pendente', 'em_separacao', 'separada'],
    });
  });

  it('com filtro, respeita o status pedido', async () => {
    const { servico, prisma } = montar([]);
    await servico.listarRequisicoes(COMPANY, 'entregue');

    expect(prisma.requisicaoMaterial.findMany.mock.calls[0][0].where.status).toBe('entregue');
  });

  it('status desconhecido não vira filtro silencioso', async () => {
    // Sem isto, `?status=qualquercoisa` devolveria lista vazia sem dizer por quê.
    const { servico } = montar([]);
    await expect(servico.listarRequisicoes(COMPANY, 'inventado')).rejects.toThrow();
  });
});

describe('detalharRequisicao', () => {
  it('requisição de outra empresa é 404, não vazamento', async () => {
    const { servico } = montar([], null);
    await expect(servico.detalharRequisicao(OUTRA, 'req-1')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('traz os itens e o depósito na mesma consulta', async () => {
    const { servico, prisma } = montar([], { id: 'req-1', itens: [] });
    await servico.detalharRequisicao(COMPANY, 'req-1');

    const args = prisma.requisicaoMaterial.findFirst.mock.calls[0][0];
    expect(args.where).toEqual({ id: 'req-1', companyId: COMPANY });
    expect(args.include.itens).toBeTruthy();
    expect(args.include.deposito).toBe(true);
  });
});
