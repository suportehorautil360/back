import { BadRequestException, ConflictException } from '@nestjs/common';
import { decidirEquivalente, proporEquivalente } from './equivalente';

const COMPANY = '11111111-1111-1111-1111-111111111111';
const REQ = '33333333-3333-3333-3333-333333333333';
const AUTOR = '44444444-4444-4444-4444-444444444444';
const ORIGINAL = 'p-original';
const EQUIVALENTE = 'p-equivalente';

type Linha = Record<string, any>;

interface Opcoes {
  statusRequisicao?: string;
  statusDoItem?: string;
  /** A peça original NÃO lista a proposta como equivalente. */
  semVinculo?: boolean;
  /** A peça equivalente está inativa. */
  equivalenteInativa?: boolean;
  /** Livre na equivalente (físico − reservado). Default 10, cobre o item. */
  livreNaEquivalente?: number;
  /** Quanto da ORIGINAL já estava reservado para este item. */
  reservadoNaOriginal?: number;
  /** O item já está no estado de proposta, esperando a mecânica. */
  jaProposto?: boolean;
}

/**
 * Banco fake que PERSISTE e filtra pelos `where` da produção; `where` não
 * reconhecido lança, para nenhum teste passar por um mock que devolve tudo.
 */
function montar(opts: Opcoes = {}) {
  const log: string[] = [];
  const requisicao = {
    id: REQ,
    companyId: COMPANY,
    numero: 'REQ-2026-001',
    status: opts.statusRequisicao ?? 'em_separacao',
    depositoId: 'dep-1',
    serviceOrderId: 'os-1',
  };
  const reservadoNaOriginal = opts.reservadoNaOriginal ?? 0;
  const itens = new Map<string, Linha>([
    [
      'it-1',
      opts.jaProposto
        ? {
            id: 'it-1',
            requisicaoId: REQ,
            pecaId: EQUIVALENTE,
            status: 'aguardando_equivalente',
            quantidadeSolicitada: 4,
            quantidadeReservada: reservadoNaOriginal,
            equivalenteDePecaId: ORIGINAL,
            impeditivo: true,
          }
        : {
            id: 'it-1',
            requisicaoId: REQ,
            pecaId: ORIGINAL,
            status: opts.statusDoItem ?? 'faltante',
            quantidadeSolicitada: 4,
            quantidadeReservada: reservadoNaOriginal,
            equivalenteDePecaId: null,
            impeditivo: true,
          },
    ],
  ]);
  // `saldo_fisico` alto de propósito: o que aperta no teste é o LIVRE.
  const livre = opts.livreNaEquivalente ?? 10;
  const saldos = new Map<string, Linha>([
    [
      `${ORIGINAL}|dep-1`,
      { saldoFisico: 50, saldoReservado: reservadoNaOriginal },
    ],
    [`${EQUIVALENTE}|dep-1`, { saldoFisico: livre, saldoReservado: 0 }],
  ]);
  const pecas = new Map<string, Linha>([
    [
      ORIGINAL,
      {
        id: ORIGINAL,
        companyId: COMPANY,
        ativo: true,
        descricao: 'Filtro Mann',
        equivalentes: opts.semVinculo ? [] : [EQUIVALENTE],
      },
    ],
    [
      EQUIVALENTE,
      {
        id: EQUIVALENTE,
        companyId: COMPANY,
        ativo: !opts.equivalenteInativa,
        descricao: 'Filtro Fram',
        equivalentes: [ORIGINAL],
      },
    ],
  ]);
  const auditoria: Linha[] = [];
  const estado = { log, requisicao, itens, pecas, saldos, auditoria };

  const naoReconhecido = (onde: string, arg: unknown): never => {
    throw new Error(
      `${onde}: where não reconhecido neste fake — ${JSON.stringify(arg)}`,
    );
  };

  const tx = {
    $queryRaw: jest.fn(async (q: { text: string; values: unknown[] }) => {
      if (q.text.includes('FROM requisicoes_material')) {
        log.push('trava:req');
        return requisicao.id === q.values[0] &&
          requisicao.companyId === q.values[1]
          ? [{ id: REQ }]
          : [];
      }
      if (q.text.includes('FROM peca_saldos')) {
        const [pecaId, depositoId] = q.values as [string, string];
        log.push(`trava:saldo:${pecaId}`);
        return saldos.has(`${pecaId}|${depositoId}`)
          ? [{ peca_id: pecaId }]
          : [];
      }
      throw new Error(`SQL não reconhecido: ${q.text}`);
    }),
    $executeRaw: jest.fn(async (q: { text: string; values: unknown[] }) => {
      if (!q.text.includes('UPDATE peca_saldos'))
        throw new Error(`SQL não reconhecido: ${q.text}`);
      // Lê o sinal do próprio SQL: um fake de sinal fixo não veria uma
      // soltura escrita com `+` no lugar de `-`.
      const m = q.text.match(/saldo_reservado\s*=\s*saldo_reservado\s*([+-])/);
      if (!m)
        throw new Error(`UPDATE de saldo fora do formato esperado: ${q.text}`);
      const [quantidade, pecaId, depositoId] = q.values as [
        number,
        string,
        string,
      ];
      const linha = saldos.get(`${pecaId}|${depositoId}`);
      if (!linha) return 0;
      if (m[1] === '+') {
        // Honra a guarda `saldo_fisico - saldo_reservado >= quantidade`: é ela
        // que faz a corrida ser perdida em vez de virar saldo negativo.
        if (linha.saldoFisico - linha.saldoReservado < quantidade) return 0;
        linha.saldoReservado += quantidade;
        log.push(`reserva:${pecaId}`);
      } else {
        linha.saldoReservado -= quantidade;
        log.push(`solta:${pecaId}`);
      }
      return 1;
    }),
    requisicaoMaterial: {
      findUniqueOrThrow: jest.fn(
        async ({ where }: { where: { id: string } }) => {
          if (where.id !== REQ)
            return naoReconhecido('requisicaoMaterial', where);
          return { ...requisicao };
        },
      ),
    },
    requisicaoMaterialItem: {
      findFirst: jest.fn(
        async ({ where }: { where: { id: string; requisicaoId: string } }) => {
          const i = itens.get(where.id);
          return i && i.requisicaoId === where.requisicaoId ? { ...i } : null;
        },
      ),
      update: jest.fn(
        async ({ where, data }: { where: { id: string }; data: Linha }) => {
          const i = itens.get(where.id);
          if (!i) return naoReconhecido('item.update', where);
          Object.assign(i, data);
          log.push('update:item');
          return { ...i };
        },
      ),
    },
    peca: {
      findFirst: jest.fn(
        async ({ where }: { where: { id: string; companyId: string } }) => {
          const p = pecas.get(where.id);
          return p && p.companyId === where.companyId ? { ...p } : null;
        },
      ),
    },
    companyUser: {
      findFirst: jest.fn(async () => ({ name: 'Ana', email: 'ana@x.com' })),
    },
    pontoAuditoria: {
      create: jest.fn(async ({ data }: { data: Linha }) => {
        auditoria.push({ ...data });
        log.push('auditoria');
        return data;
      }),
    },
  };
  return { tx, estado };
}

const entrada = (extra: Partial<Record<string, unknown>> = {}) => ({
  companyId: COMPANY,
  requisicaoId: REQ,
  itemId: 'it-1',
  pecaEquivalenteId: EQUIVALENTE,
  autorCompanyUserId: AUTOR,
  motivo: 'Mann em falta, Fram serve na 320D',
  ...extra,
});

describe('proporEquivalente', () => {
  it('o item passa a apontar para a equivalente e guarda de qual peça ela é substituta', async () => {
    const { tx, estado } = montar();

    const r = await proporEquivalente(tx as never, entrada());

    expect(r).toMatchObject({
      itemId: 'it-1',
      status: 'aguardando_equivalente',
    });
    expect(estado.itens.get('it-1')).toMatchObject({
      pecaId: EQUIVALENTE,
      equivalenteDePecaId: ORIGINAL,
      status: 'aguardando_equivalente',
    });
  });

  it('trava a requisição ANTES de mexer no item', async () => {
    const { tx, estado } = montar();
    await proporEquivalente(tx as never, entrada());
    expect(estado.log.indexOf('trava:req')).toBeLessThan(
      estado.log.indexOf('update:item'),
    );
  });

  it('peça que a original NÃO lista como equivalente é recusada', async () => {
    // Sem esta trava, "equivalente" vira qualquer peça do catálogo, e a
    // aprovação técnica passa a decidir sobre uma troca que ninguém cadastrou.
    const { tx, estado } = montar({ semVinculo: true });
    await expect(proporEquivalente(tx as never, entrada())).rejects.toThrow(
      BadRequestException,
    );
    expect(estado.itens.get('it-1')!.status).toBe('faltante');
  });

  it('peça equivalente inativa é recusada', async () => {
    const { tx } = montar({ equivalenteInativa: true });
    await expect(proporEquivalente(tx as never, entrada())).rejects.toThrow(
      BadRequestException,
    );
  });

  it('item que não está faltante não tem troca a propor', async () => {
    // Item reservado ou separado já tem a peça na mão: trocar aqui mexeria em
    // saldo comprometido, que é assunto de outro ato.
    const { tx } = montar({ statusDoItem: 'separada' });
    await expect(proporEquivalente(tx as never, entrada())).rejects.toThrow(
      ConflictException,
    );
  });

  it('requisição já entregue não aceita proposta', async () => {
    const { tx } = montar({ statusRequisicao: 'entregue' });
    await expect(proporEquivalente(tx as never, entrada())).rejects.toThrow(
      ConflictException,
    );
  });

  it('grava o rastro com a peça de antes e a de depois', async () => {
    const { tx, estado } = montar();
    await proporEquivalente(tx as never, entrada());
    expect(estado.auditoria).toEqual([
      expect.objectContaining({
        companyId: COMPANY,
        acao: 'requisicao.equivalente_proposto',
        alvoTipo: 'suprimentos.requisicao',
        alvoId: REQ,
        atorId: AUTOR,
        motivo: 'Mann em falta, Fram serve na 320D',
        antes: expect.objectContaining({ pecaId: ORIGINAL }),
        depois: expect.objectContaining({ pecaId: EQUIVALENTE }),
      }),
    ]);
  });
});

const decisao = (extra: Partial<Record<string, unknown>> = {}) => ({
  companyId: COMPANY,
  requisicaoId: REQ,
  itemId: 'it-1',
  autorCompanyUserId: AUTOR,
  aprovar: true,
  motivo: 'Fram serve nesta máquina',
  ...extra,
});

describe('decidirEquivalente', () => {
  it('aprovada: reserva a equivalente inteira e solta o que estava preso na original', async () => {
    const { tx, estado } = montar({ jaProposto: true, reservadoNaOriginal: 3 });

    const r = await decidirEquivalente(tx as never, decisao());

    expect(r).toMatchObject({ aprovado: true, status: 'reservada' });
    expect(estado.saldos.get(`${EQUIVALENTE}|dep-1`)!.saldoReservado).toBe(4);
    expect(estado.saldos.get(`${ORIGINAL}|dep-1`)!.saldoReservado).toBe(0);
    expect(estado.itens.get('it-1')).toMatchObject({
      pecaId: EQUIVALENTE,
      equivalenteDePecaId: ORIGINAL,
      status: 'reservada',
      quantidadeReservada: 4,
    });
  });

  it('recusada pela mecânica: o item volta a faltante com a peça original e sem vínculo', async () => {
    const { tx, estado } = montar({ jaProposto: true });

    const r = await decidirEquivalente(
      tx as never,
      decisao({ aprovar: false, motivo: 'Fram não veda nesta bomba' }),
    );

    expect(r).toMatchObject({ aprovado: false });
    expect(estado.itens.get('it-1')).toMatchObject({
      pecaId: ORIGINAL,
      equivalenteDePecaId: null,
      status: 'faltante',
    });
    expect(estado.saldos.get(`${EQUIVALENTE}|dep-1`)!.saldoReservado).toBe(0);
  });

  it('aprovada mas o saldo da equivalente acabou no meio: recusa e devolve o item a faltante', async () => {
    // A troca é reserva, não consulta: entre a proposta e a aprovação outra OS
    // pode ter levado o saldo. Aprovar contra um número lido antes deixaria o
    // item "reservado" sem nada reservado de verdade.
    const { tx, estado } = montar({ jaProposto: true, livreNaEquivalente: 1 });

    const r = await decidirEquivalente(tx as never, decisao());

    expect(r).toMatchObject({ aprovado: false, semSaldo: true });
    expect(estado.itens.get('it-1')).toMatchObject({
      pecaId: ORIGINAL,
      equivalenteDePecaId: null,
      status: 'faltante',
    });
    expect(estado.saldos.get(`${EQUIVALENTE}|dep-1`)!.saldoReservado).toBe(0);
  });

  it('trava a requisição e depois os saldos na ordem do comparador do módulo', async () => {
    const { tx, estado } = montar({ jaProposto: true, reservadoNaOriginal: 3 });

    await decidirEquivalente(tx as never, decisao());

    const travas = estado.log.filter((l) => l.startsWith('trava:'));
    expect(travas[0]).toBe('trava:req');
    const saldos = travas.slice(1);
    expect(saldos).toEqual([...saldos].sort());
  });

  it('item que não está esperando aprovação não tem o que decidir', async () => {
    const { tx } = montar({ statusDoItem: 'faltante' });
    await expect(decidirEquivalente(tx as never, decisao())).rejects.toThrow(
      ConflictException,
    );
  });

  it('grava o rastro de cada desfecho com o motivo de quem decidiu', async () => {
    const { tx, estado } = montar({ jaProposto: true });
    await decidirEquivalente(
      tx as never,
      decisao({ aprovar: false, motivo: 'não veda' }),
    );
    expect(estado.auditoria).toEqual([
      expect.objectContaining({
        acao: 'requisicao.equivalente_recusado',
        alvoTipo: 'suprimentos.requisicao',
        alvoId: REQ,
        atorId: AUTOR,
        motivo: 'não veda',
      }),
    ]);
  });
});
