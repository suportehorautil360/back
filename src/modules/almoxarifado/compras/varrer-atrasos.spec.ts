import { varrerAtrasos } from './varrer-atrasos';

const EMPRESA = 'c1';
type Linha = Record<string, any>;

function montar(ordens: Linha[], opts: { semDestinatario?: boolean } = {}) {
  const notificacoes: Linha[] = [];
  const prisma = {
    companyFeature: { findMany: jest.fn(async () => [{ companyId: EMPRESA }]) },
    ordemCompra: { findMany: jest.fn(async () => ordens) },
    // Espelha a consulta REAL de `usuariosDoGrupo`: duas etapas, cargo e
    // operador. Um fake de uma etapa só deixou passar um `where` que nem
    // compila — foi o build que pegou, não este teste.
    companyRole: {
      findMany: jest.fn(async () => (opts.semDestinatario ? [] : [{ id: 'cargo-1' }])),
    },
    operator: {
      findMany: jest.fn(async () => [{ companyUserId: 'cu-1' }]),
    },
    company: { findUnique: jest.fn(async () => ({ legacyId: 'leg-1' })) },
    notificacao: {
      createMany: jest.fn(async ({ data }: { data: Linha[] }) => {
        notificacoes.push(...data);
        return { count: data.length };
      }),
    },
  };
  return { prisma, notificacoes };
}

const ordem = (p: Linha = {}): Linha => ({
  id: 'oc-1',
  numero: 'OC-2026-001',
  status: 'enviada',
  previsaoEntrega: new Date('2026-09-10T00:00:00Z'),
  itens: [
    {
      origens: [
        {
          solicitacaoCompraItem: {
            requisicaoItem: { requisicao: { serviceOrder: { id: 'os-1', protocolo: 'OS-2026-047' } } },
          },
        },
      ],
    },
  ],
  ...p,
});

const HOJE = new Date('2026-09-16T10:00:00Z');

describe('varrerAtrasos', () => {
  it('avisa sobre a ordem atrasada com os dias e a OS impactada', async () => {
    const { prisma, notificacoes } = montar([ordem()]);

    const r = await varrerAtrasos(prisma as never, HOJE);

    expect(r).toMatchObject({ empresas: 1, atrasadas: 1 });
    expect(notificacoes).toHaveLength(1);
    expect(notificacoes[0].mensagem).toContain('OC-2026-001');
    expect(notificacoes[0].mensagem).toContain('6 dia');
    expect(notificacoes[0].mensagem).toContain('OS-2026-047');
  });

  it('ordem no prazo não gera aviso nenhum', async () => {
    const { prisma, notificacoes } = montar([
      ordem({ previsaoEntrega: new Date('2026-09-30T00:00:00Z') }),
    ]);
    const r = await varrerAtrasos(prisma as never, HOJE);
    expect(r.atrasadas).toBe(0);
    expect(notificacoes).toHaveLength(0);
  });

  it('atrasada sem OS impactada avisa mesmo assim — é dinheiro parado', async () => {
    // Reposição por estoque mínimo não tem OS atrás. O comprador ainda
    // precisa saber que o fornecedor furou o prazo.
    const { prisma, notificacoes } = montar([ordem({ itens: [{ origens: [] }] })]);
    const r = await varrerAtrasos(prisma as never, HOJE);
    expect(r.atrasadas).toBe(1);
    expect(notificacoes).toHaveLength(1);
    expect(notificacoes[0].mensagem).not.toContain('OS-');
  });

  it('a mesma OS citada por duas linhas aparece uma vez só', async () => {
    const duasLinhas = ordem({
      itens: [ordem().itens[0], ordem().itens[0]],
    });
    const { prisma, notificacoes } = montar([duasLinhas]);
    await varrerAtrasos(prisma as never, HOJE);
    expect(notificacoes[0].mensagem.match(/OS-2026-047/g)).toHaveLength(1);
  });

  it('empresa sem ninguém para avisar não quebra a varredura', async () => {
    const { prisma, notificacoes } = montar([ordem()], { semDestinatario: true });
    const r = await varrerAtrasos(prisma as never, HOJE);
    expect(r.atrasadas).toBe(1);
    expect(notificacoes).toHaveLength(0);
  });

  it('falha numa empresa conta como falha e não derruba a varredura', async () => {
    const { prisma } = montar([ordem()]);
    prisma.ordemCompra.findMany = jest.fn(async () => {
      throw new Error('pool esgotado');
    });
    const r = await varrerAtrasos(prisma as never, HOJE);
    expect(r).toMatchObject({ falhas: 1, atrasadas: 0 });
  });
});
