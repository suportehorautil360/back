import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { abrirInventario } from './inventario';

const COMPANY = '11111111-1111-1111-1111-111111111111';
const AUTOR = '44444444-4444-4444-4444-444444444444';
type Linha = Record<string, any>;

function montar(opts: { jaAberta?: boolean; depositoDeOutra?: boolean } = {}) {
  const inventarios: Linha[] = opts.jaAberta
    ? [{ id: 'inv-0', companyId: COMPANY, depositoId: 'dep-1', numero: 'INV-2026-001', status: 'aberta' }]
    : [];
  const itens: Linha[] = [];
  const auditoria: Linha[] = [];
  const estado = { inventarios, itens, auditoria };

  const tx = {
    deposito: {
      findFirst: jest.fn(async ({ where }: { where: { id: string; companyId: string } }) =>
        opts.depositoDeOutra || where.companyId !== COMPANY
          ? null
          : { id: where.id, nome: 'Central' },
      ),
    },
    peca: {
      findMany: jest.fn(
        async ({
          where,
        }: {
          where: { id: { in: string[] }; companyId?: string; ativo?: boolean };
        }) => {
          if (where.companyId === undefined) {
            throw new Error('banco falso: peca.findMany sem escopo de empresa — onde é isso?');
          }
          if (where.ativo === undefined) {
            throw new Error('banco falso: peca.findMany sem filtro de ativo — onde é isso?');
          }
          if (where.companyId !== COMPANY || where.ativo !== true) return [];
          return where.id.in.filter((id) => id !== 'p-inexistente').map((id) => ({ id }));
        },
      ),
    },
    inventario: {
      findFirst: jest.fn(async ({ where }: { where: { depositoId: string; status: string } }) =>
        inventarios.find((i) => i.depositoId === where.depositoId && i.status === where.status) ?? null,
      ),
      findMany: jest.fn(
        async ({
          where,
        }: {
          where: { companyId?: string; numero?: { startsWith?: string } };
        }) => {
          if (where.companyId === undefined) {
            throw new Error('banco falso: inventario.findMany sem escopo de empresa — onde é isso?');
          }
          const prefixo = where.numero?.startsWith;
          if (typeof prefixo !== 'string') {
            throw new Error('banco falso: inventario.findMany sem prefixo de número — onde é isso?');
          }
          return inventarios
            .filter((i) => i.companyId === where.companyId && (i.numero as string).startsWith(prefixo))
            .map((i) => ({ numero: i.numero }));
        },
      ),
      create: jest.fn(async ({ data }: { data: Linha }) => {
        const novo = { id: 'inv-1', ...data };
        inventarios.push(novo);
        return novo;
      }),
    },
    inventarioItem: {
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

const entrada = (extra: Partial<Record<string, unknown>> = {}) => ({
  companyId: COMPANY, depositoId: 'dep-1', pecaIds: ['p-1', 'p-2'],
  autorCompanyUserId: AUTOR, observacao: 'contagem de setembro', ...extra,
});

describe('abrirInventario', () => {
  // A numeração (`INV-2026-...`) depende do ano corrente — sem congelar o
  // relógio, a suíte quebra sozinha em 2027-01-01. Mesmo padrão de
  // `uploads.service.spec.ts` (`uploadSelfiePonto`).
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2026-09-17T12:00:00.000Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('nasce aberta, numerada, com um item por peça', async () => {
    const { tx, estado } = montar();
    const r = await abrirInventario(tx as never, entrada());
    expect(r).toMatchObject({ numero: 'INV-2026-001', itens: 2 });
    expect(estado.itens).toHaveLength(2);
    expect(estado.itens[0]).toMatchObject({ inventarioId: 'inv-1', quantidadeContada: null });
  });

  it('o número continua do MAX do ano, não do total de linhas', async () => {
    const { tx } = montar({ jaAberta: true });
    // A aberta de `inv-0` é `INV-2026-001`; a próxima é a 002 — mas só depois
    // que ela for apurada. Este teste prova a numeração, não o bloqueio:
    // a de `inv-0` é de OUTRO depósito.
    const r = await abrirInventario(tx as never, entrada({ depositoId: 'dep-2' }));
    expect(r.numero).toBe('INV-2026-002');
  });

  it('depósito que já tem contagem aberta é recusado', async () => {
    const { tx } = montar({ jaAberta: true });
    await expect(abrirInventario(tx as never, entrada())).rejects.toThrow(ConflictException);
  });

  it('depósito de outra empresa não é encontrado', async () => {
    const { tx } = montar({ depositoDeOutra: true });
    await expect(abrirInventario(tx as never, entrada())).rejects.toThrow(NotFoundException);
  });

  it('peça que não existe na empresa é recusada, e nada é criado', async () => {
    const { tx, estado } = montar();
    await expect(
      abrirInventario(tx as never, entrada({ pecaIds: ['p-1', 'p-inexistente'] })),
    ).rejects.toThrow(BadRequestException);
    expect(estado.inventarios).toHaveLength(0);
  });

  it('contagem sem peça nenhuma é recusada', async () => {
    const { tx } = montar();
    await expect(abrirInventario(tx as never, entrada({ pecaIds: [] }))).rejects.toThrow(BadRequestException);
  });

  it('peça repetida na abertura vira um item só', async () => {
    const { tx, estado } = montar();
    await abrirInventario(tx as never, entrada({ pecaIds: ['p-1', 'p-1', 'p-2'] }));
    expect(estado.itens).toHaveLength(2);
  });

  it('grava o rastro da abertura', async () => {
    const { tx, estado } = montar();
    await abrirInventario(tx as never, entrada());
    expect(estado.auditoria).toEqual([
      expect.objectContaining({
        acao: 'inventario.abrir',
        alvoTipo: 'suprimentos.inventario',
        alvoId: 'inv-1',
        atorId: AUTOR,
      }),
    ]);
  });
});
