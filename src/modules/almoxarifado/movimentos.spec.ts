import { BadRequestException } from '@nestjs/common';
import { AlmoxarifadoService } from './almoxarifado.service';

const COMPANY = '11111111-1111-1111-1111-111111111111';
const OUTRA = '22222222-2222-2222-2222-222222222222';

function movimento(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'mov-1',
    companyId: COMPANY,
    pecaId: 'peca-1',
    depositoId: 'dep-1',
    tipo: 'entrada',
    quantidade: '4.000',
    saldoApos: '10.000',
    custoUnit: '12.5000',
    origemTipo: 'ajuste_manual',
    origemId: null,
    autorCompanyUserId: 'user-1',
    observacao: null,
    createdAt: new Date('2026-09-10T12:00:00.000Z'),
    peca: { codigoInterno: 'FIL-001', descricao: 'Filtro de óleo' },
    deposito: { nome: 'Almoxarifado Central' },
    ...overrides,
  };
}

function montar(movimentos: unknown[] = [], total = movimentos.length, autores: unknown[] = []) {
  const prisma = {
    estoqueMovimento: {
      count: jest.fn().mockResolvedValue(total),
      findMany: jest.fn().mockResolvedValue(movimentos),
    },
    companyUser: {
      findMany: jest.fn().mockResolvedValue(autores),
    },
  };
  return { servico: new AlmoxarifadoService(prisma as never), prisma };
}

describe('listarMovimentos', () => {
  it('escopa por empresa — no findMany e no count', async () => {
    const { servico, prisma } = montar([]);
    await servico.listarMovimentos(COMPANY, {});

    expect(prisma.estoqueMovimento.findMany.mock.calls[0][0].where.companyId).toBe(COMPANY);
    expect(prisma.estoqueMovimento.count.mock.calls[0][0].where.companyId).toBe(COMPANY);
  });

  it('nunca escopa por OUTRA empresa que não a do painel', async () => {
    // Prova negativa complementar: o `where` nunca pode carregar um
    // companyId diferente do que veio do guard — não há parâmetro nenhum
    // do chamador capaz de sobrescrever isso.
    const { servico, prisma } = montar([]);
    await servico.listarMovimentos(COMPANY, {});

    expect(prisma.estoqueMovimento.findMany.mock.calls[0][0].where.companyId).not.toBe(OUTRA);
  });

  it('mais recente primeiro — o oposto da fila FIFO do almoxarife', async () => {
    const { servico, prisma } = montar([]);
    await servico.listarMovimentos(COMPANY, {});

    expect(prisma.estoqueMovimento.findMany.mock.calls[0][0].orderBy).toEqual({
      createdAt: 'desc',
    });
  });

  it('filtra por pecaId quando informado', async () => {
    const { servico, prisma } = montar([]);
    await servico.listarMovimentos(COMPANY, { pecaId: 'peca-9' });

    expect(prisma.estoqueMovimento.findMany.mock.calls[0][0].where.pecaId).toBe('peca-9');
  });

  it('filtra por depositoId quando informado', async () => {
    const { servico, prisma } = montar([]);
    await servico.listarMovimentos(COMPANY, { depositoId: 'dep-9' });

    expect(prisma.estoqueMovimento.findMany.mock.calls[0][0].where.depositoId).toBe('dep-9');
  });

  it('filtra por tipo quando informado', async () => {
    const { servico, prisma } = montar([]);
    await servico.listarMovimentos(COMPANY, { tipo: 'saida' });

    expect(prisma.estoqueMovimento.findMany.mock.calls[0][0].where.tipo).toBe('saida');
  });

  it('sem filtro nenhum, não restringe pecaId/depositoId/tipo no where', async () => {
    const { servico, prisma } = montar([]);
    await servico.listarMovimentos(COMPANY, {});

    const where = prisma.estoqueMovimento.findMany.mock.calls[0][0].where;
    expect(where.pecaId).toBeUndefined();
    expect(where.depositoId).toBeUndefined();
    expect(where.tipo).toBeUndefined();
  });

  it('tipo desconhecido não vira filtro silencioso — e o banco nem é consultado', async () => {
    const { servico, prisma } = montar([]);
    await expect(servico.listarMovimentos(COMPANY, { tipo: 'roubo' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    // A validação roda ANTES da consulta — sem isto, o `rejects` acima só
    // provaria que uma exceção sobe, não que o banco não foi tocado.
    expect(prisma.estoqueMovimento.findMany).not.toHaveBeenCalled();
    expect(prisma.estoqueMovimento.count).not.toHaveBeenCalled();
  });

  it('aceita os cinco tipos válidos do razão sem lançar', async () => {
    const { servico } = montar([]);
    for (const tipo of ['entrada', 'saida', 'ajuste', 'devolucao', 'transferencia']) {
      await expect(servico.listarMovimentos(COMPANY, { tipo })).resolves.toBeDefined();
    }
  });

  it('paginação: page/pageSize viram skip/take', async () => {
    const { servico, prisma } = montar([]);
    await servico.listarMovimentos(COMPANY, { page: 2, pageSize: 20 });

    const args = prisma.estoqueMovimento.findMany.mock.calls[0][0];
    expect(args.skip).toBe(40);
    expect(args.take).toBe(20);
  });

  it('paginação: valores default quando nada é informado', async () => {
    const { servico, prisma } = montar([]);
    const resultado = await servico.listarMovimentos(COMPANY, {});

    const args = prisma.estoqueMovimento.findMany.mock.calls[0][0];
    expect(args.skip).toBe(0);
    expect(args.take).toBe(50);
    expect(resultado.page).toBe(0);
    expect(resultado.pageSize).toBe(50);
  });

  it('paginação: pageSize é limitada a 200, mesmo se pedirem mais', async () => {
    const { servico, prisma } = montar([]);
    await servico.listarMovimentos(COMPANY, { pageSize: 5000 });

    expect(prisma.estoqueMovimento.findMany.mock.calls[0][0].take).toBe(200);
  });

  it('paginação: page/pageSize não-numéricos (NaN) caem no default, não em skip NaN', async () => {
    const { servico, prisma } = montar([]);
    await servico.listarMovimentos(COMPANY, { page: Number('abc'), pageSize: Number('xyz') });

    const args = prisma.estoqueMovimento.findMany.mock.calls[0][0];
    expect(args.skip).toBe(0);
    expect(args.take).toBe(50);
  });

  it('devolve o total da contagem, não o tamanho da página', async () => {
    const { servico } = montar([movimento()], 137);
    const resultado = await servico.listarMovimentos(COMPANY, {});

    expect(resultado.total).toBe(137);
    expect(resultado.rows).toHaveLength(1);
  });

  it('traz código/descrição da peça e nome do depósito na mesma consulta (sem N+1)', async () => {
    const { servico, prisma } = montar([]);
    await servico.listarMovimentos(COMPANY, {});

    const args = prisma.estoqueMovimento.findMany.mock.calls[0][0];
    expect(args.include.peca).toEqual({ select: { codigoInterno: true, descricao: true } });
    expect(args.include.deposito).toEqual({ select: { nome: true } });
  });

  it('resolve o nome de quem fez o movimento com UMA consulta extra, por ids distintos', async () => {
    const { servico, prisma } = montar(
      [
        movimento({ id: 'mov-1', autorCompanyUserId: 'user-1' }),
        movimento({ id: 'mov-2', autorCompanyUserId: 'user-1' }),
        movimento({ id: 'mov-3', autorCompanyUserId: 'user-2' }),
      ],
      3,
      [
        { id: 'user-1', name: 'Almoxarife A' },
        { id: 'user-2', name: 'Almoxarife B' },
      ],
    );

    const resultado = await servico.listarMovimentos(COMPANY, {});

    // Uma consulta só, mesmo com três movimentos.
    expect(prisma.companyUser.findMany).toHaveBeenCalledTimes(1);
    const idsConsultados = prisma.companyUser.findMany.mock.calls[0][0].where.id.in;
    expect(new Set(idsConsultados)).toEqual(new Set(['user-1', 'user-2']));
    // Não duplica: dois movimentos do mesmo autor não viram dois ids na lista.
    expect(idsConsultados).toHaveLength(2);

    expect(resultado.rows[0].autorNome).toBe('Almoxarife A');
    expect(resultado.rows[1].autorNome).toBe('Almoxarife A');
    expect(resultado.rows[2].autorNome).toBe('Almoxarife B');
  });

  it('autor sem CompanyUser encontrado (removido) não quebra a linha', async () => {
    const { servico } = montar(
      [movimento({ autorCompanyUserId: 'user-sumiu' })],
      1,
      [], // companyUser.findMany não acha ninguém
    );

    const resultado = await servico.listarMovimentos(COMPANY, {});

    expect(resultado.rows[0].autorNome).toBe('Usuário removido');
  });

  it('sem movimentos, não consulta companyUser à toa', async () => {
    const { servico, prisma } = montar([], 0);
    await servico.listarMovimentos(COMPANY, {});

    expect(prisma.companyUser.findMany).not.toHaveBeenCalled();
  });

  it('a quantidade viaja COM SINAL, sem transformação — a tela decide como mostrar', async () => {
    const { servico } = montar([movimento({ quantidade: '-3.000' })], 1, [
      { id: 'user-1', name: 'Almoxarife A' },
    ]);

    const resultado = await servico.listarMovimentos(COMPANY, {});

    expect(resultado.rows[0].quantidade).toBe('-3.000');
  });
});
