import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { cancelarTransferencia, criarTransferencia } from './transferencia';

const COMPANY = '11111111-1111-1111-1111-111111111111';
const AUTOR = '44444444-4444-4444-4444-444444444444';
type Linha = Record<string, any>;

function montarCriacao(opts: { pecaDeOutra?: boolean } = {}) {
  const transferencias: Linha[] = [
    { id: 'trf-0', companyId: COMPANY, numero: 'TRF-2026-001', status: 'recebida' },
  ];
  const itens: Linha[] = [];
  const auditoria: Linha[] = [];
  const estado = { transferencias, itens, auditoria };

  const tx = {
    deposito: {
      findMany: jest.fn(async ({ where }: { where: { id: { in: string[] }; companyId?: string } }) => {
        if (!where.companyId) throw new Error('banco falso: deposito.findMany sem escopo de empresa.');
        return where.companyId === COMPANY ? where.id.in.map((id) => ({ id })) : [];
      }),
    },
    peca: {
      findMany: jest.fn(async ({ where }: { where: { id: { in: string[] }; companyId?: string; ativo?: boolean } }) => {
        if (!where.companyId || where.ativo === undefined) {
          throw new Error('banco falso: peca.findMany sem escopo de empresa ou sem filtro de ativo.');
        }
        if (opts.pecaDeOutra) return [];
        return where.companyId === COMPANY ? where.id.in.map((id) => ({ id })) : [];
      }),
    },
    transferencia: {
      findMany: jest.fn(async ({ where }: { where: { companyId?: string; numero?: { startsWith?: string } } }) => {
        if (!where.companyId || typeof where.numero?.startsWith !== 'string') {
          throw new Error('banco falso: transferencia.findMany sem empresa ou sem prefixo de ano.');
        }
        return transferencias
          .filter((t) => t.companyId === where.companyId && (t.numero as string).startsWith(where.numero!.startsWith!))
          .map((t) => ({ numero: t.numero }));
      }),
      findFirst: jest.fn(async ({ where }: { where: { id: string; companyId: string } }) => {
        if (!where.companyId) throw new Error('banco falso: findFirst sem escopo de empresa.');
        const t = transferencias.find((x) => x.id === where.id && x.companyId === where.companyId);
        return t ? { ...t } : null;
      }),
      create: jest.fn(async ({ data }: { data: Linha }) => {
        const nova = { id: 'trf-1', ...data };
        transferencias.push(nova);
        return nova;
      }),
      update: jest.fn(async ({ where, data }: { where: { id: string }; data: Linha }) => {
        Object.assign(transferencias.find((t) => t.id === where.id)!, data);
        return {};
      }),
    },
    transferenciaItem: {
      createMany: jest.fn(async ({ data }: { data: Linha[] }) => {
        itens.push(...data);
        return { count: data.length };
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

const criacao = (extra: Partial<Record<string, unknown>> = {}) => ({
  companyId: COMPANY, depositoOrigemId: 'dep-a', depositoDestinoId: 'dep-b',
  itens: [{ pecaId: 'p-1', quantidade: 4 }],
  autorCompanyUserId: AUTOR, observacao: 'reposição da obra leste', ...extra,
});

describe('criarTransferencia', () => {
  it('nasce rascunho, numerada, com um item por peça', async () => {
    const { tx, estado } = montarCriacao();
    const r = await criarTransferencia(tx as never, criacao());
    expect(r).toMatchObject({ numero: 'TRF-2026-002', itens: 1 });
    expect(estado.transferencias.find((t) => t.id === 'trf-1')).toMatchObject({ status: 'rascunho' });
  });

  it('origem igual ao destino é recusada antes de tocar o banco', async () => {
    const { tx, estado } = montarCriacao();
    await expect(
      criarTransferencia(tx as never, criacao({ depositoDestinoId: 'dep-a' })),
    ).rejects.toThrow(BadRequestException);
    expect(estado.itens).toHaveLength(0);
  });

  it('sem item nenhum é recusada', async () => {
    const { tx } = montarCriacao();
    await expect(criarTransferencia(tx as never, criacao({ itens: [] }))).rejects.toThrow(BadRequestException);
  });

  it('quantidade zero ou negativa é recusada', async () => {
    const { tx } = montarCriacao();
    await expect(
      criarTransferencia(tx as never, criacao({ itens: [{ pecaId: 'p-1', quantidade: 0 }] })),
    ).rejects.toThrow(BadRequestException);
  });

  it('peça repetida é recusada — some as quantidades numa linha só', async () => {
    const { tx } = montarCriacao();
    await expect(
      criarTransferencia(tx as never, criacao({
        itens: [{ pecaId: 'p-1', quantidade: 2 }, { pecaId: 'p-1', quantidade: 3 }],
      })),
    ).rejects.toThrow(BadRequestException);
  });

  it('peça de outra empresa é recusada, e nada é criado', async () => {
    const { tx, estado } = montarCriacao({ pecaDeOutra: true });
    await expect(criarTransferencia(tx as never, criacao())).rejects.toThrow(BadRequestException);
    expect(estado.itens).toHaveLength(0);
  });

  it('grava o rastro da criação', async () => {
    const { tx, estado } = montarCriacao();
    await criarTransferencia(tx as never, criacao());
    expect(estado.auditoria).toEqual([
      expect.objectContaining({
        acao: 'transferencia.criar',
        alvoTipo: 'suprimentos.transferencia',
        alvoId: 'trf-1',
        atorId: AUTOR,
      }),
    ]);
  });
});

describe('cancelarTransferencia', () => {
  const cancelamento = (extra: Partial<Record<string, unknown>> = {}) => ({
    companyId: COMPANY, transferenciaId: 'trf-1',
    autorCompanyUserId: AUTOR, motivo: 'pedida por engano', ...extra,
  });

  it('cancela o RASCUNHO, que não moveu saldo nenhum', async () => {
    const { tx, estado } = montarCriacao();
    await criarTransferencia(tx as never, criacao());

    const r = await cancelarTransferencia(tx as never, cancelamento());

    expect(r).toMatchObject({ numero: 'TRF-2026-002' });
    expect(estado.transferencias.find((t) => t.id === 'trf-1')).toMatchObject({
      status: 'cancelada',
      motivoCancelamento: 'pedida por engano',
    });
  });

  it('transferência EM TRÂNSITO não cancela — a peça está no caminhão', async () => {
    // Cancelar o que já saiu seria inventar uma volta que ninguém dirigiu. O
    // caminho para carga perdida é confirmar com quantidade recebida zero.
    const { tx, estado } = montarCriacao();
    await criarTransferencia(tx as never, criacao());
    Object.assign(estado.transferencias.find((t) => t.id === 'trf-1')!, { status: 'em_transito' });

    await expect(cancelarTransferencia(tx as never, cancelamento())).rejects.toThrow(ConflictException);
  });

  it('sem motivo não cancela', async () => {
    const { tx } = montarCriacao();
    await criarTransferencia(tx as never, criacao());
    await expect(
      cancelarTransferencia(tx as never, cancelamento({ motivo: '  ' })),
    ).rejects.toThrow(BadRequestException);
  });

  it('transferência de outra empresa não é encontrada', async () => {
    const { tx } = montarCriacao();
    await criarTransferencia(tx as never, criacao());
    await expect(
      cancelarTransferencia(tx as never, cancelamento({ companyId: '99999999-9999-9999-9999-999999999999' })),
    ).rejects.toThrow(NotFoundException);
  });
});
