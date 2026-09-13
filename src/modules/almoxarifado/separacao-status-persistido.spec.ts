import { ConflictException } from '@nestjs/common';
import { AlmoxarifadoService } from './almoxarifado.service';

const COMPANY = '11111111-1111-1111-1111-111111111111';
const REQ = '33333333-3333-3333-3333-333333333333';
const AUTOR = '44444444-4444-4444-4444-444444444444';
const OUTRO_AUTOR = '77777777-7777-7777-7777-777777777777';

/**
 * Achado Critical N1 da rodada 3: nenhum teste da suíte olhava o status
 * GRAVADO na requisição — só o RETORNADO por `separarItens`. A guarda
 * `status: { not: 'separada' }`, pendurada como a ÚNICA escrita, fazia uma
 * reconferência que REBAIXA o status (confere menos, ou informa divergência
 * num kit já `separada`) casar zero linhas: o banco ficava em `separada`
 * obsoleto enquanto a resposta HTTP devolvia `em_separacao` — e o único
 * portão de `liberarRequisicao` (`req.status !== 'separada'`) abria para um
 * kit incompleto.
 *
 * Este arquivo constrói um banco fake que PERSISTE de verdade entre
 * chamadas — inclusive entre `separarItens` e `liberarRequisicao`, o
 * caminho que a regressão atravessa — ao contrário dos outros arquivos
 * desta suíte, cujos mocks (`.mockResolvedValue` fixo) nunca precisaram
 * disso porque cada teste chama o serviço uma vez só.
 */
function montarBancoFake() {
  const requisicao = {
    id: REQ,
    companyId: COMPANY,
    status: 'pendente',
    serviceOrderId: 'os-1',
    depositoId: 'dep-1',
    numero: 'REQ-2026-001',
    liberadaEm: null as Date | null,
    liberadaPorCompanyUserId: null as string | null,
    atendidaPorCompanyUserId: null as string | null,
    atendidaEm: null as Date | null,
  };
  // I4 da revisão final da F3: o `statusMateriais` GRAVADO na OS.
  const os = { statusMateriais: 'planejada' };
  const item = {
    id: 'it-1', pecaId: 'p-1', quantidadeReservada: 4, quantidadeSeparada: 0,
    status: 'reservada', impeditivo: true, divergencia: null as string | null,
  };

  const tx = {
    $queryRaw: jest.fn(async () => [{ saldo_separado: '0', saldo_fisico: '10', saldo_reservado: '4' }]),
    $executeRaw: jest.fn(async () => 1),
    requisicaoMaterial: {
      // Lê o estado ATUAL de `requisicao` a cada chamada — nunca um retrato
      // fixo. É isso que permite `liberarRequisicao` (chamada depois de duas
      // `separarItens`) enxergar o status que a segunda de fato gravou.
      findFirst: jest.fn(async () => ({
        ...requisicao,
        itens: [item],
        serviceOrder: { protocolo: 'OS-2026-047', equipmentId: null, equipmentNome: null, responsavelOperatorId: null },
        deposito: { nome: 'Almoxarifado Central' },
      })),
      // Simula as DUAS formas de `where` que a produção usa hoje:
      // `status: { not: 'separada' }` (fechamento do kit, achado I3/N1) e
      // `liberadaEm: null` (liberação, achado I3). Cada uma só "casa" (e só
      // então grava) quando a condição bate contra o estado ATUAL — exatamente
      // o comportamento de um `updateMany` condicional de verdade.
      updateMany: jest.fn(async ({ where, data }: {
        where: { id: string; status?: { not: string }; liberadaEm?: null };
        data: Record<string, unknown>;
      }) => {
        if (where.status !== undefined) {
          if (requisicao.status === where.status.not) return { count: 0 };
          Object.assign(requisicao, data);
          return { count: 1 };
        }
        if (where.liberadaEm !== undefined) {
          if (requisicao.liberadaEm !== null) return { count: 0 };
          Object.assign(requisicao, data);
          return { count: 1 };
        }
        throw new Error('where não reconhecido neste fake — atualize o teste');
      }),
      // A escrita INCONDICIONAL (achado Critical N1): tanto a transição
      // REVERSA quanto o "só regravar atendidaEm/atendidaPor" da requisição
      // já fechada passam por aqui.
      update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        Object.assign(requisicao, data);
        return { ...requisicao };
      }),
      // Fundação da F4: o status relido com a requisição travada — mesma fonte
      // de verdade de `findFirst`.
      findUniqueOrThrow: jest.fn(async () => ({ ...requisicao })),
    },
    requisicaoMaterialItem: {
      findUniqueOrThrow: jest.fn(async () => ({ ...item })),
      update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        Object.assign(item, data);
        return { ...item };
      }),
      findMany: jest.fn(async () => [{ ...item }]),
    },
    // Notificação: sem destinatário nos dois caminhos — fora do escopo
    // deste arquivo (já coberto em `almoxarifado-notificacoes.spec.ts`,
    // `entrega.spec.ts` e `separacao-servico.spec.ts`). O que importa aqui
    // é o STATUS PERSISTIDO, não quem é avisado.
    companyRole: { findMany: jest.fn(async () => []) },
    operator: {
      findMany: jest.fn(async () => []),
      findFirst: jest.fn(async () => null),
    },
    equipmentProgramador: { findMany: jest.fn(async () => []) },
    company: { findUnique: jest.fn(async () => ({ legacyId: 'leg-1' })) },
    notificacao: { createMany: jest.fn(async () => ({ count: 1 })) },
    serviceOrder: {
      updateMany: jest.fn(async ({ data }: { data: { statusMateriais: string } }) => {
        os.statusMateriais = data.statusMateriais;
        return { count: 1 };
      }),
    },
  };

  const prisma = {
    $transaction: jest.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
    requisicaoMaterial: tx.requisicaoMaterial,
    notificacao: tx.notificacao,
  };

  return { servico: new AlmoxarifadoService(prisma as never), requisicao, tx, os };
}

describe('separarItens — o status GRAVADO tem de bater com o RETORNADO (achado Critical N1)', () => {
  it('reconferência que REBAIXA o kit (conferir menos) grava a reversão no banco, não só na resposta', async () => {
    const { servico, requisicao } = montarBancoFake();

    // Confere TUDO: o kit fecha.
    const r1 = await servico.separarItens({
      companyId: COMPANY, requisicaoId: REQ, autorCompanyUserId: AUTOR,
      itens: [{ itemId: 'it-1', quantidade: 4 }],
    });
    expect(r1.statusRequisicao).toBe('separada');
    expect(requisicao.status).toBe('separada');

    // Reconfere com quantidade MENOR — o item deixa de estar "separada"
    // (statusDoItemAposSeparacao exige quantidade >= reservada) e o kit
    // deixa de estar fechado.
    const r2 = await servico.separarItens({
      companyId: COMPANY, requisicaoId: REQ, autorCompanyUserId: AUTOR,
      itens: [{ itemId: 'it-1', quantidade: 2 }],
    });
    expect(r2.statusRequisicao).toBe('em_separacao');
    // O BANCO tem de refletir a MESMA coisa. É exatamente aqui que o
    // Critical N1 vivia: com a guarda pendurada na única escrita, esta
    // linha reprovava — `requisicao.status` continuava `'separada'`,
    // obsoleto, porque `where: { status: { not: 'separada' } }` não casava
    // nenhuma linha (o banco JÁ estava `separada`) e nada mais escrevia.
    expect(requisicao.status).toBe('em_separacao');
  });
});

describe('liberarRequisicao — o portão bloqueia um kit rebaixado (achado Critical N1)', () => {
  it('depois de uma reconferência que rebaixa o status, liberar recusa em vez de liberar kit incompleto', async () => {
    const { servico, requisicao } = montarBancoFake();

    await servico.separarItens({
      companyId: COMPANY, requisicaoId: REQ, autorCompanyUserId: AUTOR,
      itens: [{ itemId: 'it-1', quantidade: 4 }],
    });
    await servico.separarItens({
      companyId: COMPANY, requisicaoId: REQ, autorCompanyUserId: AUTOR,
      itens: [{ itemId: 'it-1', quantidade: 2 }],
    });
    // Pré-condição do teste: sem isto, um teste que passa por acaso (banco
    // ainda `separada`) não provaria nada sobre o portão.
    expect(requisicao.status).toBe('em_separacao');

    // Com o Critical N1 presente, o banco ficaria obsoleto em `separada` e
    // este `await` resolveria — liberando um kit que não está completo.
    await expect(servico.liberarRequisicao({
      companyId: COMPANY, requisicaoId: REQ, autorCompanyUserId: AUTOR,
    })).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('separarItens — as escritas da requisição e da OS, pelo que foi GRAVADO (I4/I5 da revisão final da F3)', () => {
  it('P2: reconferir um kit já fechado mantém o banco em separada e regrava quem mexeu por último', async () => {
    const { servico, requisicao } = montarBancoFake();
    await servico.separarItens({
      companyId: COMPANY, requisicaoId: REQ, autorCompanyUserId: AUTOR,
      itens: [{ itemId: 'it-1', quantidade: 4 }],
    });
    await servico.separarItens({
      companyId: COMPANY, requisicaoId: REQ, autorCompanyUserId: OUTRO_AUTOR,
      itens: [{ itemId: 'it-1', quantidade: 4 }],
    });
    expect(requisicao.status).toBe('separada');
    expect(requisicao.atendidaPorCompanyUserId).toBe(OUTRO_AUTOR);
    expect(requisicao.atendidaEm).toBeInstanceOf(Date);
  });

  it('P3: conferência parcial grava no banco quem conferiu e quando', async () => {
    const { servico, requisicao } = montarBancoFake();
    await servico.separarItens({
      companyId: COMPANY, requisicaoId: REQ, autorCompanyUserId: AUTOR,
      itens: [{ itemId: 'it-1', quantidade: 2 }],
    });
    expect(requisicao.status).toBe('em_separacao');
    expect(requisicao.atendidaPorCompanyUserId).toBe(AUTOR);
    expect(requisicao.atendidaEm).toBeInstanceOf(Date);
  });

  it('I4: o statusMateriais GRAVADO na OS acompanha o kit — fecha e rebaixa', async () => {
    const { servico, os } = montarBancoFake();
    await servico.separarItens({
      companyId: COMPANY, requisicaoId: REQ, autorCompanyUserId: AUTOR,
      itens: [{ itemId: 'it-1', quantidade: 4 }],
    });
    expect(os.statusMateriais).toBe('materiais_separados');
    await servico.separarItens({
      companyId: COMPANY, requisicaoId: REQ, autorCompanyUserId: AUTOR,
      itens: [{ itemId: 'it-1', quantidade: 2 }],
    });
    expect(os.statusMateriais).toBe('aguardando_separacao');
  });
});
