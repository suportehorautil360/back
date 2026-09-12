import { AlmoxarifadoService } from './almoxarifado.service';

const COMPANY = '11111111-1111-1111-1111-111111111111';
const REQ = '33333333-3333-3333-3333-333333333333';
const AUTOR = '44444444-4444-4444-4444-444444444444';

function montar(itens: unknown[]) {
  const chamadas: string[] = [];
  const tx = {
    $queryRaw: jest.fn(async () => {
      chamadas.push('LOCK');
      return [{ saldo_fisico: '10', saldo_reservado: '4', saldo_separado: '0' }];
    }),
    $executeRaw: jest.fn(async () => {
      chamadas.push('UPDATE saldo');
      return 1;
    }),
    requisicaoMaterial: {
      findFirst: jest.fn().mockResolvedValue({
        id: REQ, companyId: COMPANY, status: 'pendente',
        serviceOrderId: 'os-1', depositoId: 'dep-1', itens,
      }),
      update: jest.fn(async () => { chamadas.push('UPDATE requisicao'); return {}; }),
    },
    requisicaoMaterialItem: {
      update: jest.fn(async () => { chamadas.push('UPDATE item'); return {}; }),
    },
    serviceOrder: {
      updateMany: jest.fn(async () => { chamadas.push('UPDATE os'); return { count: 1 }; }),
    },
  };
  const prisma = {
    $transaction: jest.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
    // A leitura da requisição (para validar TUDO antes de abrir a transação)
    // usa `this.prisma`, não `tx` — igual a um `PrismaService` de verdade, em
    // que o mesmo delegate de modelo atende fora e dentro de `$transaction`.
    // Sem isto o mock não tem como responder a essa chamada, e o serviço
    // nunca chega a decidir se abre transação ou recusa antes dela.
    requisicaoMaterial: tx.requisicaoMaterial,
  };
  return { servico: new AlmoxarifadoService(prisma as never), prisma, tx, chamadas };
}

const item = (p = {}) => ({
  id: 'it-1', pecaId: 'p-1', quantidadeReservada: 4, quantidadeSeparada: 0,
  status: 'reservada', impeditivo: true, divergencia: null, ...p,
});

describe('separarItens', () => {
  it('trava a linha do saldo antes de mexer no separado', async () => {
    const { servico, chamadas } = montar([item()]);
    await servico.separarItens({
      companyId: COMPANY, requisicaoId: REQ, autorCompanyUserId: AUTOR,
      itens: [{ itemId: 'it-1', quantidade: 4 }],
    });
    expect(chamadas[0]).toBe('LOCK');
    expect(chamadas).toContain('UPDATE saldo');
  });

  it('conferir tudo fecha o kit e leva a OS a materiais_separados', async () => {
    const { servico } = montar([item()]);
    const r = await servico.separarItens({
      companyId: COMPANY, requisicaoId: REQ, autorCompanyUserId: AUTOR,
      itens: [{ itemId: 'it-1', quantidade: 4 }],
    });
    expect(r.statusRequisicao).toBe('separada');
    expect(r.statusMateriais).toBe('materiais_separados');
  });

  it('conferir em parte deixa a requisição em separação', async () => {
    const { servico } = montar([item()]);
    const r = await servico.separarItens({
      companyId: COMPANY, requisicaoId: REQ, autorCompanyUserId: AUTOR,
      itens: [{ itemId: 'it-1', quantidade: 2 }],
    });
    expect(r.statusRequisicao).toBe('em_separacao');
    expect(r.statusMateriais).toBe('aguardando_separacao');
  });

  it('separar mais do que o reservado é recusado com mensagem', async () => {
    const { servico, prisma } = montar([item()]);
    await expect(servico.separarItens({
      companyId: COMPANY, requisicaoId: REQ, autorCompanyUserId: AUTOR,
      itens: [{ itemId: 'it-1', quantidade: 9 }],
    })).rejects.toThrow(/4 reservado/);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('item que não pertence à requisição é recusado', async () => {
    // Sem isto, um itemId de outra requisição faria o saldo de outra OS mexer.
    const { servico } = montar([item()]);
    await expect(servico.separarItens({
      companyId: COMPANY, requisicaoId: REQ, autorCompanyUserId: AUTOR,
      itens: [{ itemId: 'it-de-outra', quantidade: 1 }],
    })).rejects.toThrow();
  });

  it('divergência registrada não deixa o kit fechar', async () => {
    // Spec funcional, pág. 6: "divergência impede a liberação".
    const { servico } = montar([item()]);
    const r = await servico.separarItens({
      companyId: COMPANY, requisicaoId: REQ, autorCompanyUserId: AUTOR,
      itens: [{ itemId: 'it-1', quantidade: 4, divergencia: 'veio avariada' }],
    });
    expect(r.statusRequisicao).toBe('em_separacao');
  });
});
