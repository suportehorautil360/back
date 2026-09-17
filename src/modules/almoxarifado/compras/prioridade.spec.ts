import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { alterarPrioridadeDoItem } from './prioridade';

const COMPANY = '11111111-1111-1111-1111-111111111111';
const AUTOR = '44444444-4444-4444-4444-444444444444';

type Linha = Record<string, any>;

interface Opcoes {
  statusSolicitacao?: string;
  /** Prioridades dos dois itens da solicitação, na ordem. */
  prioridades?: [string, string];
  statusDoSegundoItem?: string;
}

/** Banco fake que persiste e filtra pelos `where` da produção. */
function montar(opts: Opcoes = {}) {
  const log: string[] = [];
  const [p1, p2] = opts.prioridades ?? ['alta', 'alta'];
  const solicitacao = {
    id: 'sc-1', companyId: COMPANY, numero: 'SC-2026-001',
    status: opts.statusSolicitacao ?? 'pendente', prioridade: 'alta',
  };
  const itens = new Map<string, Linha>([
    ['sci-1', { id: 'sci-1', solicitacaoId: 'sc-1', prioridade: p1, status: 'aberta' }],
    ['sci-2', { id: 'sci-2', solicitacaoId: 'sc-1', prioridade: p2, status: opts.statusDoSegundoItem ?? 'aberta' }],
  ]);
  const auditoria: Linha[] = [];
  const estado = { log, solicitacao, itens, auditoria };

  const tx = {
    $queryRaw: jest.fn(async (q: { text: string; values: unknown[] }) => {
      if (q.text.includes('FROM solicitacao_compra_itens')) {
        log.push('trava:item');
        return itens.has(q.values[0] as string) ? [{ id: q.values[0] }] : [];
      }
      if (q.text.includes('FROM solicitacoes_compra')) {
        log.push('trava:solicitacao');
        return solicitacao.id === q.values[0] ? [{ id: 'sc-1' }] : [];
      }
      throw new Error(`SQL não reconhecido: ${q.text}`);
    }),
    solicitacaoCompraItem: {
      // Filtra pela EMPRESA de verdade: um fake que só casa o id deixaria
      // passar item de outra empresa, e o teste do escopo não provaria nada.
      findFirst: jest.fn(
        async ({ where }: { where: { id: string; solicitacao: { companyId: string } } }) => {
          if (!where.solicitacao?.companyId) {
            throw new Error('findFirst sem filtro de empresa — o escopo é obrigatório aqui.');
          }
          const i = itens.get(where.id);
          if (!i || solicitacao.companyId !== where.solicitacao.companyId) return null;
          return { ...i, solicitacao: { ...solicitacao } };
        },
      ),
      findMany: jest.fn(async ({ where }: { where: { solicitacaoId: string; status?: unknown } }) =>
        [...itens.values()]
          .filter((i) => i.solicitacaoId === where.solicitacaoId && i.status !== 'cancelada')
          .map((i) => ({ ...i })),
      ),
      update: jest.fn(async ({ where, data }: { where: { id: string }; data: Linha }) => {
        Object.assign(itens.get(where.id)!, data);
        log.push('update:item');
        return {};
      }),
    },
    solicitacaoCompra: {
      update: jest.fn(async ({ data }: { data: Linha }) => {
        Object.assign(solicitacao, data);
        log.push('update:solicitacao');
        return {};
      }),
    },
    companyUser: { findFirst: jest.fn(async () => ({ name: 'Ana', email: 'a@x.com' })) },
    pontoAuditoria: {
      create: jest.fn(async ({ data }: { data: Linha }) => {
        auditoria.push({ ...data });
        return data;
      }),
    },
  };
  return { tx, estado };
}

const entrada = (extra: Partial<Record<string, unknown>> = {}) => ({
  companyId: COMPANY, solicitacaoItemId: 'sci-1', prioridade: 'critica',
  autorCompanyUserId: AUTOR, motivo: 'Máquina parada em obra', ...extra,
});

describe('alterarPrioridadeDoItem', () => {
  it('muda a prioridade do item', async () => {
    const { tx, estado } = montar();
    const r = await alterarPrioridadeDoItem(tx as never, entrada());
    expect(r).toMatchObject({ solicitacaoItemId: 'sci-1', prioridade: 'critica' });
    expect(estado.itens.get('sci-1')!.prioridade).toBe('critica');
  });

  it('o cabeçalho passa a valer o MAIOR dos itens — nunca achata o do outro item', async () => {
    // O cabeçalho nasce como o máximo dos itens (`some(impeditivo)`). Gravar
    // nele a prioridade do item alterado faria uma linha comum rebaixar a
    // solicitação inteira e sumir com a peça que está parando a máquina.
    const { tx, estado } = montar({ prioridades: ['alta', 'critica'] });
    await alterarPrioridadeDoItem(tx as never, entrada({ prioridade: 'reposicao' }));
    expect(estado.itens.get('sci-1')!.prioridade).toBe('reposicao');
    expect(estado.solicitacao.prioridade).toBe('critica');
  });

  it('item cancelado não conta para o cabeçalho', async () => {
    const { tx, estado } = montar({ prioridades: ['alta', 'critica'], statusDoSegundoItem: 'cancelada' });
    await alterarPrioridadeDoItem(tx as never, entrada({ prioridade: 'normal' }));
    expect(estado.solicitacao.prioridade).toBe('normal');
  });

  it('trava o ITEM antes do cabeçalho — é a ordem única do módulo', async () => {
    const { tx, estado } = montar();
    await alterarPrioridadeDoItem(tx as never, entrada());
    expect(estado.log.indexOf('trava:item')).toBeLessThan(estado.log.indexOf('trava:solicitacao'));
  });

  it('sem motivo não muda nada', async () => {
    const { tx, estado } = montar();
    await expect(alterarPrioridadeDoItem(tx as never, entrada({ motivo: '  ' }))).rejects.toThrow(BadRequestException);
    expect(estado.itens.get('sci-1')!.prioridade).toBe('alta');
  });

  it('prioridade fora das quatro é recusada', async () => {
    const { tx } = montar();
    await expect(alterarPrioridadeDoItem(tx as never, entrada({ prioridade: 'urgentissima' }))).rejects.toThrow(BadRequestException);
  });

  it('solicitação encerrada não tem prioridade a mudar', async () => {
    const { tx } = montar({ statusSolicitacao: 'cancelada' });
    await expect(alterarPrioridadeDoItem(tx as never, entrada())).rejects.toThrow(ConflictException);
  });

  it('item de outra empresa não é encontrado', async () => {
    const { tx } = montar();
    await expect(
      alterarPrioridadeDoItem(tx as never, entrada({ companyId: '99999999-9999-9999-9999-999999999999' })),
    ).rejects.toThrow(NotFoundException);
  });

  it('grava o rastro com o de antes, o de depois e o motivo', async () => {
    const { tx, estado } = montar();
    await alterarPrioridadeDoItem(tx as never, entrada());
    expect(estado.auditoria).toEqual([expect.objectContaining({
      companyId: COMPANY,
      acao: 'solicitacao_compra.prioridade',
      alvoTipo: 'suprimentos.solicitacao_compra',
      alvoId: 'sc-1',
      atorId: AUTOR,
      motivo: 'Máquina parada em obra',
      antes: expect.objectContaining({ prioridade: 'alta' }),
      depois: expect.objectContaining({ prioridade: 'critica' }),
    })]);
  });
});
