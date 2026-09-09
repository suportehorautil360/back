import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { MecanicaService } from './mecanica.service';
import type { PainelPayload } from '../../common/painel.guard';
import { Prisma } from '../../prisma/generated/client';

const PAINEL: PainelPayload = {
  companyUserId: 'user-1',
  companyId: 'empresa-1',
  operatorId: 'op-1',
  companyRoleId: 'cargo-1',
  nomeExibicao: 'Carlos Mecânico',
};

/**
 * Prisma falso que APLICA o `where` recebido sobre uma tabela em memória.
 * Um stub que devolve lista fixa passaria mesmo com o filtro apagado — que é
 * exatamente o defeito que estes testes existem para pegar.
 */
function prismaCom(linhas: Record<string, unknown>[]) {
  const casa = (linha: Record<string, unknown>, where: Record<string, unknown>) =>
    Object.entries(where).every(([k, v]) => linha[k] === v);
  return {
    serviceOrder: {
      findMany: jest.fn(({ where }) => Promise.resolve(linhas.filter((l) => casa(l, where)))),
      findFirst: jest.fn(({ where }) =>
        Promise.resolve(linhas.find((l) => casa(l, where)) ?? null),
      ),
    },
  } as never;
}

const LINHAS = [
  { id: 'os-interna', companyId: 'empresa-1', execucao: 'interna', responsavelOperatorId: null },
  { id: 'os-parceira', companyId: 'empresa-1', execucao: 'parceira', responsavelOperatorId: null },
  { id: 'os-outra-empresa', companyId: 'empresa-2', execucao: 'interna', responsavelOperatorId: null },
  { id: 'os-de-outro', companyId: 'empresa-1', execucao: 'interna', responsavelOperatorId: 'op-9' },
];

describe('MecanicaService.listarBancada', () => {
  it('devolve só OS interna da empresa do token', async () => {
    const s = new MecanicaService(prismaCom(LINHAS));
    const r = await s.listarBancada(PAINEL, false);
    expect(r.map((o) => o.id).sort()).toEqual(['os-de-outro', 'os-interna']);
  });

  it('nunca devolve OS parceira', async () => {
    const s = new MecanicaService(prismaCom(LINHAS));
    const r = await s.listarBancada(PAINEL, false);
    expect(r.some((o) => o.id === 'os-parceira')).toBe(false);
  });

  it('nunca devolve OS de outra empresa', async () => {
    const s = new MecanicaService(prismaCom(LINHAS));
    const r = await s.listarBancada(PAINEL, false);
    expect(r.some((o) => o.id === 'os-outra-empresa')).toBe(false);
  });

  it('com apenasMinhas, recorta pelo responsável do token', async () => {
    const s = new MecanicaService(prismaCom(LINHAS));
    const r = await s.listarBancada(PAINEL, true);
    expect(r).toEqual([]);
  });
});

/**
 * Achado C2 da revisão final: o Histórico (`?situacao=Concluida`) e a
 * Bancada (sem `?situacao`) batiam na mesma lista porque o filtro nunca
 * chegava ao `where`. `LINHAS_POR_SITUACAO` tem as três situações na mesma
 * empresa — sem o filtro de verdade, `situacao=Concluida` devolveria as três.
 */
describe('MecanicaService.listarBancada — filtro por situacao', () => {
  const LINHAS_POR_SITUACAO = [
    { id: 'os-aberta', companyId: 'empresa-1', execucao: 'interna', situacao: 'Aberta', responsavelOperatorId: null },
    { id: 'os-em-andamento', companyId: 'empresa-1', execucao: 'interna', situacao: 'EmAndamento', responsavelOperatorId: null },
    { id: 'os-concluida', companyId: 'empresa-1', execucao: 'interna', situacao: 'Concluida', responsavelOperatorId: null },
  ];

  it('com situacao=Concluida, só volta OS concluída', async () => {
    const s = new MecanicaService(prismaCom(LINHAS_POR_SITUACAO));
    const r = await s.listarBancada(PAINEL, false, 'Concluida');
    expect(r.map((o) => o.id)).toEqual(['os-concluida']);
  });

  it('sem o parâmetro, voltam todas', async () => {
    const s = new MecanicaService(prismaCom(LINHAS_POR_SITUACAO));
    const r = await s.listarBancada(PAINEL, false);
    expect(r.map((o) => o.id).sort()).toEqual([
      'os-aberta',
      'os-concluida',
      'os-em-andamento',
    ]);
  });
});

describe('MecanicaService.detalhe', () => {
  it('404 para OS de outra empresa', async () => {
    const s = new MecanicaService(prismaCom(LINHAS));
    await expect(s.detalhe(PAINEL, 'os-outra-empresa')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('404 para OS parceira — não existe para este módulo', async () => {
    const s = new MecanicaService(prismaCom(LINHAS));
    await expect(s.detalhe(PAINEL, 'os-parceira')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('devolve a OS interna da empresa', async () => {
    const s = new MecanicaService(prismaCom(LINHAS));
    await expect(s.detalhe(PAINEL, 'os-interna')).resolves.toMatchObject({
      id: 'os-interna',
    });
  });
});

const d = (hhmm: string) => new Date(`2026-09-08T${hhmm}:00-03:00`);

/**
 * Fake dedicado ao `include` de `detalhe`. Continua aplicando o `where` de
 * verdade sobre a OS (mesma regra dos demais fakes deste arquivo — um fake
 * que ganhasse `include` e esquecesse o `where` esvaziaria a suíte em
 * silêncio), e além disso RESOLVE o `include`: filtra cada relação por
 * `serviceOrderId` e ordena pelo `orderBy` que o serviço de fato pediu, em
 * vez de devolver uma lista fixa já na ordem esperada. Assim, se `detalhe`
 * pedir o campo ou a direção errada, o teste vê a ordem errada e cai.
 */
function prismaComRelacoes(
  os: Record<string, unknown>,
  relacoes: {
    apontamentos?: Record<string, unknown>[];
    insumos?: Record<string, unknown>[];
    fotos?: Record<string, unknown>[];
    ocorrencias?: Record<string, unknown>[];
    laudo?: Record<string, unknown> | null;
    responsavel?: Record<string, unknown> | null;
    /** Tabela de apoio pra resolver `apontamentos[].operator` por `operatorId`. */
    operadores?: Record<string, unknown>[];
  },
) {
  const casa = (l: Record<string, unknown>, w: Record<string, unknown>) =>
    Object.entries(w).every(([k, v]) => l[k] === v);

  const aplicarOrderBy = (
    linhas: Record<string, unknown>[],
    orderBy?: Record<string, 'asc' | 'desc'>,
  ) => {
    if (!orderBy) return [...linhas];
    const [[campo, direcao]] = Object.entries(orderBy);
    const sinal = direcao === 'desc' ? -1 : 1;
    return [...linhas].sort((a, b) => {
      const av = a[campo] as number | string | Date;
      const bv = b[campo] as number | string | Date;
      if (av < bv) return -1 * sinal;
      if (av > bv) return 1 * sinal;
      return 0;
    });
  };

  const doOs = (linhas: Record<string, unknown>[] = []) =>
    linhas.filter((l) => l.serviceOrderId === os.id);

  /**
   * Aplica `select` de verdade sobre o registro — sem isso, uma mutação que
   * tirasse `nome` do `select` do responsável/operador não derrubaria teste
   * nenhum, porque o fake sempre devolveria o fixture inteiro.
   */
  const aplicarSelect = (
    registro: Record<string, unknown> | null,
    select?: Record<string, boolean>,
  ) => {
    if (!registro || !select) return registro;
    return Object.fromEntries(
      Object.entries(registro).filter(([campo]) => select[campo]),
    );
  };

  return {
    serviceOrder: {
      findFirst: jest.fn(({ where, include }) => {
        if (!casa(os, where)) return Promise.resolve(null);
        if (!include) return Promise.resolve({ ...os });

        const resultado: Record<string, unknown> = { ...os };
        if (include.responsavel) {
          resultado.responsavel = aplicarSelect(
            relacoes.responsavel ?? null,
            include.responsavel.select,
          );
        }
        if (include.apontamentos) {
          const apontamentosOrdenados = aplicarOrderBy(
            doOs(relacoes.apontamentos),
            include.apontamentos.orderBy,
          );
          const includeOperator = include.apontamentos.include?.operator;
          resultado.apontamentos = includeOperator
            ? apontamentosOrdenados.map((ap) => ({
                ...ap,
                operator: aplicarSelect(
                  (relacoes.operadores ?? []).find(
                    (op) => op.id === ap.operatorId,
                  ) ?? null,
                  includeOperator.select,
                ),
              }))
            : apontamentosOrdenados;
        }
        if (include.insumos) {
          resultado.insumos = aplicarOrderBy(
            doOs(relacoes.insumos),
            include.insumos.orderBy,
          );
        }
        if (include.fotos) {
          resultado.fotos = aplicarOrderBy(
            doOs(relacoes.fotos),
            include.fotos.orderBy,
          );
        }
        if (include.ocorrencias) {
          resultado.ocorrencias = aplicarOrderBy(
            doOs(relacoes.ocorrencias),
            include.ocorrencias.orderBy,
          );
        }
        if (include.laudo) {
          resultado.laudo = relacoes.laudo ?? null;
        }
        return Promise.resolve(resultado);
      }),
    },
  } as never;
}

/**
 * Contrato com o painel: `detalhe` tem que devolver as cinco relações da
 * tela de detalhe já populadas — a tela quebraria em runtime com
 * `undefined.map(...)` se alguma vier ausente.
 */
describe('MecanicaService.detalhe — relações', () => {
  const OS = { id: 'os-1', companyId: 'empresa-1', execucao: 'interna' };

  it('devolve apontamentos, insumos, fotos, ocorrências e laudo, cada um na ordem esperada', async () => {
    const s = new MecanicaService(
      prismaComRelacoes(OS, {
        apontamentos: [
          { id: 'ap-2', serviceOrderId: 'os-1', inicio: d('10:00') },
          { id: 'ap-1', serviceOrderId: 'os-1', inicio: d('08:00') },
        ],
        insumos: [
          { id: 'in-2', serviceOrderId: 'os-1', ordem: 2 },
          { id: 'in-1', serviceOrderId: 'os-1', ordem: 1 },
        ],
        fotos: [
          { id: 'fo-2', serviceOrderId: 'os-1', createdAt: d('12:00') },
          { id: 'fo-1', serviceOrderId: 'os-1', createdAt: d('09:00') },
        ],
        ocorrencias: [
          { id: 'oc-2', serviceOrderId: 'os-1', createdAt: d('11:00') },
          { id: 'oc-1', serviceOrderId: 'os-1', createdAt: d('07:00') },
        ],
        laudo: { id: 'la-1', serviceOrderId: 'os-1', causa: 'Vazamento' },
      }),
    );

    const detalhe = await s.detalhe(PAINEL, 'os-1');

    expect(detalhe.apontamentos.map((a: { id: string }) => a.id)).toEqual([
      'ap-1',
      'ap-2',
    ]);
    expect(detalhe.insumos.map((i: { id: string }) => i.id)).toEqual([
      'in-1',
      'in-2',
    ]);
    expect(detalhe.fotos.map((f: { id: string }) => f.id)).toEqual([
      'fo-1',
      'fo-2',
    ]);
    expect(detalhe.ocorrencias.map((o: { id: string }) => o.id)).toEqual([
      'oc-1',
      'oc-2',
    ]);
    expect(detalhe.laudo).toMatchObject({ id: 'la-1', causa: 'Vazamento' });
  });
});

/**
 * Achado: a tela de detalhe mostrava o UUID cru do responsável e não dizia
 * quem apontou cada intervalo — a API não trazia `Operator.nome`. Prova aqui
 * que `detalhe` devolve o nome do responsável da OS e o nome do operador de
 * CADA apontamento, não só do primeiro.
 */
describe('MecanicaService.detalhe — nome do responsável e dos operadores', () => {
  const OS_COM_RESPONSAVEL = {
    id: 'os-1',
    companyId: 'empresa-1',
    execucao: 'interna',
    responsavelOperatorId: 'op-1',
  };

  it('traz o nome do responsável e o nome do operador de cada apontamento', async () => {
    const s = new MecanicaService(
      prismaComRelacoes(OS_COM_RESPONSAVEL, {
        responsavel: { id: 'op-1', nome: 'Carlos Mecânico' },
        apontamentos: [
          {
            id: 'ap-1',
            serviceOrderId: 'os-1',
            operatorId: 'op-1',
            inicio: d('08:00'),
          },
          {
            id: 'ap-2',
            serviceOrderId: 'os-1',
            operatorId: 'op-2',
            inicio: d('10:00'),
          },
        ],
        operadores: [
          { id: 'op-1', nome: 'Carlos Mecânico' },
          { id: 'op-2', nome: 'Beatriz Mecânica' },
        ],
      }),
    );

    const detalhe = await s.detalhe(PAINEL, 'os-1');

    expect(detalhe.responsavel).toMatchObject({ nome: 'Carlos Mecânico' });
    expect(
      detalhe.apontamentos.map(
        (a: { operator: { nome: string } }) => a.operator.nome,
      ),
    ).toEqual(['Carlos Mecânico', 'Beatriz Mecânica']);
  });

  it('devolve responsavel nulo quando ninguém assumiu a OS', async () => {
    const osSemResponsavel = {
      id: 'os-2',
      companyId: 'empresa-1',
      execucao: 'interna',
      responsavelOperatorId: null,
    };
    const s = new MecanicaService(
      prismaComRelacoes(osSemResponsavel, { responsavel: null }),
    );

    const detalhe = await s.detalhe(PAINEL, 'os-2');

    expect(detalhe.responsavel).toBeNull();
  });
});

function prismaComApontamentos(
  os: Record<string, unknown>[],
  apontamentos: Record<string, unknown>[],
) {
  const casa = (l: Record<string, unknown>, w: Record<string, unknown>) =>
    Object.entries(w).every(([k, v]) => (v === undefined ? true : l[k] === v));
  return {
    serviceOrder: {
      findFirst: jest.fn(({ where }) =>
        Promise.resolve(os.find((l) => casa(l, where)) ?? null),
      ),
      update: jest.fn(({ data }) => Promise.resolve({ ...os[0], ...data })),
      updateMany: jest.fn(({ where, data }) => {
        const alvos = os.filter((l) => casa(l, where));
        alvos.forEach((l) => Object.assign(l, data));
        return Promise.resolve({ count: alvos.length });
      }),
    },
    serviceOrderApontamento: {
      findMany: jest.fn(({ where }) =>
        Promise.resolve(apontamentos.filter((l) => casa(l, where))),
      ),
      findFirst: jest.fn(({ where }) =>
        Promise.resolve(apontamentos.find((l) => casa(l, where)) ?? null),
      ),
      create: jest.fn(({ data }) => Promise.resolve({ id: 'novo', ...data })),
      update: jest.fn(({ data }) => Promise.resolve({ id: 'ap-1', ...data })),
      delete: jest.fn(({ where }) => {
        const indice = apontamentos.findIndex((l) => casa(l, where));
        const [removido] = apontamentos.splice(indice, 1);
        return Promise.resolve(removido ?? null);
      }),
    },
    serviceOrderInsumo: {
      create: jest.fn(({ data }) => Promise.resolve({ id: 'novo', ...data })),
    },
    serviceOrderFoto: {
      create: jest.fn(({ data }) => Promise.resolve({ id: 'novo', ...data })),
    },
    serviceOrderOcorrencia: {
      create: jest.fn(({ data }) => Promise.resolve({ id: 'novo', ...data })),
    },
  } as never;
}

const OS_INTERNA = {
  id: 'os-1',
  companyId: 'empresa-1',
  execucao: 'interna',
  situacao: 'Aberta',
  responsavelOperatorId: null,
};

describe('MecanicaService — apontamento', () => {
  it('recusa iniciar quando o usuário não é funcionário', async () => {
    const s = new MecanicaService(prismaComApontamentos([OS_INTERNA], []));
    await expect(
      s.iniciarApontamento({ ...PAINEL, operatorId: null }, 'os-1', d('08:00')),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('recusa iniciar com outro apontamento aberto', async () => {
    const s = new MecanicaService(
      prismaComApontamentos(
        [OS_INTERNA],
        [{ id: 'ap-0', operatorId: 'op-1', inicio: d('07:00'), fim: null }],
      ),
    );
    await expect(
      s.iniciarApontamento(PAINEL, 'os-1', d('08:00')),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  // Achado I6 da revisão final: a checagem de sobreposição valia para
  // lançar/editar mas não para iniciar. Mecânico lançou 08:00–12:00 e às
  // 11:00 aperta "Iniciar" — sem `haSobreposicao` aqui, o sistema aceitava um
  // segundo intervalo sobreposto ao primeiro.
  it('recusa iniciar quando o horário atual se sobrepõe a um apontamento já lançado', async () => {
    const s = new MecanicaService(
      prismaComApontamentos(
        [OS_INTERNA],
        [{ id: 'ap-0', operatorId: 'op-1', inicio: d('08:00'), fim: d('12:00') }],
      ),
    );
    await expect(
      s.iniciarApontamento(PAINEL, 'os-1', d('11:00')),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('inicia gravando apontamento aberto', async () => {
    const s = new MecanicaService(prismaComApontamentos([OS_INTERNA], []));
    await expect(
      s.iniciarApontamento(PAINEL, 'os-1', d('08:00')),
    ).resolves.toMatchObject({ fim: null, operatorId: 'op-1' });
  });

  // Exigido pela spec §10. A regra é "um aberto por MECÂNICO", não "um por
  // empresa": com um mecânico só na fixture, as duas regras dão o mesmo
  // resultado e o teste passa mesmo com a implementação errada.
  it('deixa iniciar quando quem tem apontamento aberto é OUTRO mecânico', async () => {
    const s = new MecanicaService(
      prismaComApontamentos(
        [OS_INTERNA],
        [{ id: 'ap-de-outro', operatorId: 'op-2', inicio: d('07:00'), fim: null }],
      ),
    );
    await expect(
      s.iniciarApontamento(PAINEL, 'os-1', d('08:00')),
    ).resolves.toMatchObject({ fim: null, operatorId: 'op-1' });
  });

  it('recusa lançar intervalo com fim antes do início', async () => {
    const s = new MecanicaService(prismaComApontamentos([OS_INTERNA], []));
    await expect(
      s.lancarApontamento(PAINEL, 'os-1', d('11:00'), d('08:00'), null),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('recusa lançar intervalo sobreposto ao que já existe', async () => {
    const s = new MecanicaService(
      prismaComApontamentos(
        [OS_INTERNA],
        [{ id: 'ap-0', operatorId: 'op-1', inicio: d('08:00'), fim: d('10:00') }],
      ),
    );
    await expect(
      s.lancarApontamento(PAINEL, 'os-1', d('09:00'), d('11:00'), null),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('lança intervalo que não colide', async () => {
    const s = new MecanicaService(
      prismaComApontamentos(
        [OS_INTERNA],
        [{ id: 'ap-0', operatorId: 'op-1', inicio: d('08:00'), fim: d('10:00') }],
      ),
    );
    await expect(
      s.lancarApontamento(PAINEL, 'os-1', d('10:30'), d('12:00'), null),
    ).resolves.toMatchObject({ operatorId: 'op-1' });
  });
});

describe('MecanicaService.assumir', () => {
  it('recusa quem não é funcionário', async () => {
    const s = new MecanicaService(prismaComApontamentos([OS_INTERNA], []));
    await expect(
      s.assumir({ ...PAINEL, operatorId: null }, 'os-1'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('grava o responsável', async () => {
    const s = new MecanicaService(prismaComApontamentos([OS_INTERNA], []));
    await expect(s.assumir(PAINEL, 'os-1')).resolves.toMatchObject({
      responsavelOperatorId: 'op-1',
    });
  });
});

/**
 * Achado da revisão da Task 1: o índice único parcial
 * (`UNIQUE (operator_id) WHERE fim IS NULL`) não é representável na DSL do
 * Prisma, então o Client não o conhece — e a violação NÃO chega como um
 * P2002 com `meta.target` resolvido em campo (como um `@@unique` normal),
 * chega identificando o constraint pelo NOME. É a corrida de duas abas do
 * mesmo mecânico que passam juntas pela checagem prévia (`findFirst`) e só
 * colidem no INSERT — o teste simula exatamente esse erro bruto do banco.
 */
describe('MecanicaService.iniciarApontamento — corrida no índice único parcial', () => {
  const erroDoIndiceParcial = () =>
    new Prisma.PrismaClientKnownRequestError(
      'Unique constraint failed on the constraint: `service_order_apontamentos_operator_aberto_key`',
      {
        code: 'P2002',
        clientVersion: 'test',
        meta: { target: 'service_order_apontamentos_operator_aberto_key' },
      },
    );

  /** Acesso tipado ao mock de `create`, sem enfraquecer o tipo do fake em si. */
  const mockCreateDe = (prisma: unknown): jest.Mock =>
    (prisma as { serviceOrderApontamento: { create: jest.Mock } })
      .serviceOrderApontamento.create;

  it('converte a violação do índice (que passou pela checagem prévia) em ConflictException', async () => {
    const prisma = prismaComApontamentos([OS_INTERNA], []);
    mockCreateDe(prisma).mockRejectedValueOnce(erroDoIndiceParcial());
    const s = new MecanicaService(prisma);
    await expect(
      s.iniciarApontamento(PAINEL, 'os-1', d('08:00')),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('usa a mesma mensagem amigável da checagem prévia', async () => {
    const prisma = prismaComApontamentos([OS_INTERNA], []);
    mockCreateDe(prisma).mockRejectedValueOnce(erroDoIndiceParcial());
    const s = new MecanicaService(prisma);
    await expect(
      s.iniciarApontamento(PAINEL, 'os-1', d('08:00')),
    ).rejects.toThrow(
      'Já existe um apontamento em andamento. Pare o atual antes de começar outro.',
    );
  });

  it('não mexe em erro do Prisma que não é essa violação específica', async () => {
    const prisma = prismaComApontamentos([OS_INTERNA], []);
    const outroErro = new Prisma.PrismaClientKnownRequestError(
      'Foreign key constraint failed',
      { code: 'P2003', clientVersion: 'test' },
    );
    mockCreateDe(prisma).mockRejectedValueOnce(outroErro);
    const s = new MecanicaService(prisma);
    await expect(s.iniciarApontamento(PAINEL, 'os-1', d('08:00'))).rejects.toBe(
      outroErro,
    );
  });
});

/**
 * Achado da revisão da Task 6: `lancarApontamento` chama `detalhe` antes de
 * tudo, mas nenhum teste provava isso — removê-la deixaria a suíte inteira
 * verde. `detalhe` é quem garante que a OS é da empresa do token e que é
 * `execucao: 'interna'`.
 */
describe('MecanicaService.lancarApontamento — posse/empresa', () => {
  const OS_OUTRA_EMPRESA = {
    id: 'os-outra-empresa',
    companyId: 'empresa-2',
    execucao: 'interna',
    situacao: 'Aberta',
  };
  const OS_PARCEIRA = {
    id: 'os-parceira',
    companyId: 'empresa-1',
    execucao: 'parceira',
    situacao: 'Aberta',
  };

  it('404 ao lançar apontamento em OS de outra empresa', async () => {
    const s = new MecanicaService(
      prismaComApontamentos([OS_OUTRA_EMPRESA], []),
    );
    await expect(
      s.lancarApontamento(
        PAINEL,
        'os-outra-empresa',
        d('08:00'),
        d('09:00'),
        null,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('404 ao lançar apontamento em OS parceira — não existe para este módulo', async () => {
    const s = new MecanicaService(prismaComApontamentos([OS_PARCEIRA], []));
    await expect(
      s.lancarApontamento(PAINEL, 'os-parceira', d('08:00'), d('09:00'), null),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

/**
 * Achado da revisão da Task 6: `pararApontamento` não tinha NENHUM teste. O
 * código restringe por `operatorId` do token (`where: { id, operatorId }`) —
 * o teste de "não é dono" prova essa restrição de verdade, porque o fake
 * aplica o `where` recebido sobre a tabela em memória.
 */
describe('MecanicaService.pararApontamento', () => {
  it('encerra o apontamento aberto do próprio mecânico', async () => {
    const s = new MecanicaService(
      prismaComApontamentos(
        [OS_INTERNA],
        [{ id: 'ap-1', operatorId: 'op-1', inicio: d('08:00'), fim: null }],
      ),
    );
    await expect(
      s.pararApontamento(PAINEL, 'ap-1', d('10:00')),
    ).resolves.toMatchObject({ fim: d('10:00') });
  });

  it('404 ao tentar parar apontamento aberto de OUTRO mecânico', async () => {
    const s = new MecanicaService(
      prismaComApontamentos(
        [OS_INTERNA],
        [{ id: 'ap-1', operatorId: 'op-2', inicio: d('08:00'), fim: null }],
      ),
    );
    await expect(
      s.pararApontamento(PAINEL, 'ap-1', d('10:00')),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

/**
 * Achado da revisão da Task 6: `editarApontamento` não tinha NENHUM teste.
 * Além de posse, prova que a edição não colide com a PRÓPRIA versão anterior
 * do apontamento — sem excluir `apontamentoId` de `haSobreposicao`, o
 * terceiro teste abaixo falharia com `ConflictException`, porque o intervalo
 * novo está contido no antigo.
 */
describe('MecanicaService.editarApontamento', () => {
  it('edita horário e observação do próprio apontamento', async () => {
    const s = new MecanicaService(
      prismaComApontamentos(
        [OS_INTERNA],
        [
          {
            id: 'ap-1',
            operatorId: 'op-1',
            inicio: d('08:00'),
            fim: d('10:00'),
            observacao: null,
          },
          {
            id: 'ap-2',
            operatorId: 'op-1',
            inicio: d('14:00'),
            fim: d('16:00'),
            observacao: null,
          },
        ],
      ),
    );
    await expect(
      s.editarApontamento(PAINEL, 'ap-1', d('11:00'), d('12:00'), 'ajustado'),
    ).resolves.toMatchObject({
      inicio: d('11:00'),
      fim: d('12:00'),
      observacao: 'ajustado',
    });
  });

  it('404 ao tentar editar apontamento de OUTRO mecânico', async () => {
    const s = new MecanicaService(
      prismaComApontamentos(
        [OS_INTERNA],
        [
          {
            id: 'ap-1',
            operatorId: 'op-2',
            inicio: d('08:00'),
            fim: d('10:00'),
            observacao: null,
          },
        ],
      ),
    );
    await expect(
      s.editarApontamento(PAINEL, 'ap-1', d('11:00'), d('12:00'), null),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('não colide com a própria versão anterior ao só ajustar o intervalo', async () => {
    const s = new MecanicaService(
      prismaComApontamentos(
        [OS_INTERNA],
        [
          {
            id: 'ap-1',
            operatorId: 'op-1',
            inicio: d('08:00'),
            fim: d('10:00'),
            observacao: null,
          },
        ],
      ),
    );
    await expect(
      s.editarApontamento(PAINEL, 'ap-1', d('08:30'), d('09:30'), null),
    ).resolves.toMatchObject({ inicio: d('08:30'), fim: d('09:30') });
  });
});

/**
 * Achado da revisão da Task 6: `removerApontamento` não tinha NENHUM teste.
 */
describe('MecanicaService.removerApontamento', () => {
  it('remove o próprio apontamento', async () => {
    const s = new MecanicaService(
      prismaComApontamentos(
        [OS_INTERNA],
        [
          {
            id: 'ap-1',
            operatorId: 'op-1',
            inicio: d('08:00'),
            fim: d('10:00'),
          },
        ],
      ),
    );
    await expect(s.removerApontamento(PAINEL, 'ap-1')).resolves.toEqual({
      ok: true,
    });
  });

  it('404 ao tentar remover apontamento de OUTRO mecânico', async () => {
    const s = new MecanicaService(
      prismaComApontamentos(
        [OS_INTERNA],
        [
          {
            id: 'ap-1',
            operatorId: 'op-2',
            inicio: d('08:00'),
            fim: d('10:00'),
          },
        ],
      ),
    );
    await expect(s.removerApontamento(PAINEL, 'ap-1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

/**
 * Achado da revisão da Task 6: com `updateMany` e `delete` como stub fixo no
 * fake, trocar este `updateMany` condicionado por um `update` incondicional
 * não quebrava teste nenhum. Cada teste usa sua PRÓPRIA cópia da OS (não a
 * `OS_INTERNA` compartilhada) para não herdar mutação de outro teste.
 */
describe('MecanicaService — a situação anda sozinha (marcarEmAndamento)', () => {
  it('primeiro apontamento leva a OS de Aberta para EmAndamento', async () => {
    const osAberta = { ...OS_INTERNA, situacao: 'Aberta' };
    const s = new MecanicaService(prismaComApontamentos([osAberta], []));
    await s.iniciarApontamento(PAINEL, 'os-1', d('08:00'));
    await expect(s.detalhe(PAINEL, 'os-1')).resolves.toMatchObject({
      situacao: 'EmAndamento',
    });
  });

  it('OS já Concluída não regride para EmAndamento', async () => {
    const osConcluida = { ...OS_INTERNA, situacao: 'Concluida' };
    const s = new MecanicaService(prismaComApontamentos([osConcluida], []));
    await s.iniciarApontamento(PAINEL, 'os-1', d('08:00'));
    await expect(s.detalhe(PAINEL, 'os-1')).resolves.toMatchObject({
      situacao: 'Concluida',
    });
  });
});

/**
 * Peça, foto e ocorrência começam todas por `detalhe(painel, osId)` — é isso
 * que impede gravar anexo numa OS de outra empresa ou de pregão. Lição da
 * revisão da Task 6: sem um teste que prove essa chamada, removê-la deixa a
 * suíte inteira verde. Por isso cada um dos três métodos abaixo tem seu par
 * "outra empresa" / "parceira", não só o caminho feliz.
 */
describe('MecanicaService — anexos', () => {
  const OS_OUTRA_EMPRESA = {
    id: 'os-outra-empresa',
    companyId: 'empresa-2',
    execucao: 'interna',
    situacao: 'Aberta',
  };
  const OS_PARCEIRA = {
    id: 'os-parceira',
    companyId: 'empresa-1',
    execucao: 'parceira',
    situacao: 'Aberta',
  };
  const PECA = {
    descricao: 'Filtro de óleo',
    quantidade: 2,
    valorUnit: 45.9,
    codigo: null,
    marca: null,
    unidade: 'un',
  };

  describe('adicionarPeca', () => {
    it('recusa peça em OS de outra empresa', async () => {
      const s = new MecanicaService(prismaComApontamentos([OS_INTERNA], []));
      await expect(
        s.adicionarPeca(PAINEL, 'os-inexistente', PECA),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('404 ao gravar peça em OS de outra empresa', async () => {
      const s = new MecanicaService(
        prismaComApontamentos([OS_OUTRA_EMPRESA], []),
      );
      await expect(
        s.adicionarPeca(PAINEL, 'os-outra-empresa', PECA),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('404 ao gravar peça em OS parceira — não existe para este módulo', async () => {
      const s = new MecanicaService(prismaComApontamentos([OS_PARCEIRA], []));
      await expect(
        s.adicionarPeca(PAINEL, 'os-parceira', PECA),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('grava a peça vinculada à OS', async () => {
      const s = new MecanicaService(prismaComApontamentos([OS_INTERNA], []));
      await expect(s.adicionarPeca(PAINEL, 'os-1', PECA)).resolves.toMatchObject({
        serviceOrderId: 'os-1',
        descricao: 'Filtro de óleo',
        quantidade: 2,
      });
    });
  });

  describe('adicionarFoto', () => {
    it('404 ao anexar foto em OS de outra empresa', async () => {
      const s = new MecanicaService(
        prismaComApontamentos([OS_OUTRA_EMPRESA], []),
      );
      await expect(
        s.adicionarFoto(PAINEL, 'os-outra-empresa', 'https://x/img.jpg', null),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('404 ao anexar foto em OS parceira — não existe para este módulo', async () => {
      const s = new MecanicaService(prismaComApontamentos([OS_PARCEIRA], []));
      await expect(
        s.adicionarFoto(PAINEL, 'os-parceira', 'https://x/img.jpg', null),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('grava a URL com quem enviou', async () => {
      const s = new MecanicaService(prismaComApontamentos([OS_INTERNA], []));
      await expect(
        s.adicionarFoto(PAINEL, 'os-1', 'https://x/img.jpg', 'antes do reparo'),
      ).resolves.toMatchObject({
        serviceOrderId: 'os-1',
        url: 'https://x/img.jpg',
        legenda: 'antes do reparo',
        enviadaPorId: 'user-1',
      });
    });
  });

  describe('adicionarOcorrencia', () => {
    it('404 ao lançar ocorrência em OS de outra empresa', async () => {
      const s = new MecanicaService(
        prismaComApontamentos([OS_OUTRA_EMPRESA], []),
      );
      await expect(
        s.adicionarOcorrencia(PAINEL, 'os-outra-empresa', 'Aguardando peça'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('404 ao lançar ocorrência em OS parceira — não existe para este módulo', async () => {
      const s = new MecanicaService(prismaComApontamentos([OS_PARCEIRA], []));
      await expect(
        s.adicionarOcorrencia(PAINEL, 'os-parceira', 'Aguardando peça'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('grava a ocorrência com o nome de quem escreveu', async () => {
      const s = new MecanicaService(prismaComApontamentos([OS_INTERNA], []));
      await expect(
        s.adicionarOcorrencia(PAINEL, 'os-1', 'Aguardando peça'),
      ).resolves.toMatchObject({
        mensagem: 'Aguardando peça',
        usuario: 'Carlos Mecânico',
      });
    });
  });
});

/**
 * Estende o padrão dos fakes anteriores: `serviceOrderLaudo` ganha
 * `findUnique`, `upsert` e `update` sobre uma tabela em memória própria, e
 * `serviceOrderApontamento.findFirst` filtra `fim: null` — é o que prova que
 * `concluir` barra a conclusão com o cronômetro rodando.
 *
 * `laudo` é copiado (`{ ...laudo }`) antes de entrar na tabela em memória:
 * sem isso, `upsert`/`update` mutariam o objeto do fixture compartilhado
 * entre os `it()` do describe (ex.: `laudoAberto`), vazando estado de um
 * teste para o outro.
 *
 * `casa` ignora uma chave do `where` quando a linha não a possui (ex.:
 * o apontamento fixture do teste de "apontamento aberto" não carrega
 * `serviceOrderId`, só `fim`) — isso mantém o filtro por `fim: null` com
 * dente de verdade, sem exigir que toda fixture repita todo campo do `where`.
 */
function prismaComLaudo(
  os: Record<string, unknown>[],
  laudo: Record<string, unknown> | null,
  apontamentos: Record<string, unknown>[] = [],
) {
  const casa = (l: Record<string, unknown>, w: Record<string, unknown>) =>
    Object.entries(w).every(([k, v]) =>
      v === undefined || !(k in l) ? true : l[k] === v,
    );
  const laudos: Record<string, unknown>[] = laudo ? [{ ...laudo }] : [];
  return {
    serviceOrder: {
      findFirst: jest.fn(({ where }) =>
        Promise.resolve(os.find((l) => casa(l, where)) ?? null),
      ),
      update: jest.fn(({ data }) => Promise.resolve({ ...os[0], ...data })),
    },
    serviceOrderLaudo: {
      findUnique: jest.fn(({ where }) =>
        Promise.resolve(laudos.find((l) => casa(l, where)) ?? null),
      ),
      upsert: jest.fn(({ where, create, update }) => {
        const indice = laudos.findIndex((l) => casa(l, where));
        if (indice === -1) {
          const novo = { id: 'novo-laudo', fechadoEm: null, ...create };
          laudos.push(novo);
          return Promise.resolve(novo);
        }
        Object.assign(laudos[indice], update);
        return Promise.resolve(laudos[indice]);
      }),
      update: jest.fn(({ where, data }) => {
        const alvo = laudos.find((l) => casa(l, where));
        if (alvo) Object.assign(alvo, data);
        return Promise.resolve(alvo ?? null);
      }),
    },
    serviceOrderApontamento: {
      findFirst: jest.fn(({ where }) =>
        Promise.resolve(apontamentos.find((l) => casa(l, where)) ?? null),
      ),
    },
  } as never;
}

describe('MecanicaService — laudo e conclusão', () => {
  const laudoAberto = {
    id: 'l-1',
    serviceOrderId: 'os-1',
    causa: 'Vazamento no cilindro',
    servicoFeito: 'Troca do retentor',
    fechadoEm: null,
  };

  it('recusa concluir sem laudo', async () => {
    const s = new MecanicaService(prismaComLaudo([OS_INTERNA], null));
    await expect(s.concluir(PAINEL, 'os-1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('conclui quando há laudo e carimba fechadoEm', async () => {
    const s = new MecanicaService(prismaComLaudo([OS_INTERNA], laudoAberto));
    await expect(s.concluir(PAINEL, 'os-1')).resolves.toMatchObject({
      situacao: 'Concluida',
    });
  });

  it('recusa editar laudo já fechado', async () => {
    const s = new MecanicaService(
      prismaComLaudo([OS_INTERNA], {
        ...laudoAberto,
        fechadoEm: new Date('2026-09-08T18:00:00-03:00'),
      }),
    );
    await expect(
      s.salvarLaudo(PAINEL, 'os-1', {
        causa: 'outra',
        servicoFeito: 'outro',
        pendencias: null,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('recusa concluir OS com apontamento ainda aberto', async () => {
    const s = new MecanicaService(
      prismaComLaudo([OS_INTERNA], laudoAberto, [
        { id: 'ap-0', operatorId: 'op-1', inicio: d('08:00'), fim: null },
      ]),
    );
    await expect(s.concluir(PAINEL, 'os-1')).rejects.toBeInstanceOf(
      ConflictException,
    );
  });
});

/**
 * Achado Important da revisão da Task 8: a suíte só exercitava os três
 * cenários de rejeição de `salvarLaudo` — o caminho de sucesso não tinha
 * teste nenhum. Uma mutação que acrescenta `autorId: painel.companyUserId`
 * ao `update` do `upsert` (fazendo o laudo passar a ter como autor quem
 * EDITOU por último, em vez de quem ESCREVEU) não derrubava teste algum.
 */
describe('MecanicaService.salvarLaudo — caminho de sucesso', () => {
  it('cria o laudo gravando autorId de quem chamou', async () => {
    const s = new MecanicaService(prismaComLaudo([OS_INTERNA], null));
    await expect(
      s.salvarLaudo(PAINEL, 'os-1', {
        causa: 'Vazamento no cilindro',
        servicoFeito: 'Troca do retentor',
        pendencias: null,
      }),
    ).resolves.toMatchObject({
      serviceOrderId: 'os-1',
      autorId: 'user-1',
      causa: 'Vazamento no cilindro',
      servicoFeito: 'Troca do retentor',
    });
  });

  // Este é o teste que dá rede à regra: laudo criado por A, editado por B —
  // o autor tem que continuar sendo A. Pega a mutação "autorId de quem
  // editou por último" porque `painelB.companyUserId` ('user-2') é diferente
  // do autor original ('user-1').
  it('mantém o autor original quando outro usuário edita o laudo', async () => {
    const laudoDeA = {
      id: 'l-1',
      serviceOrderId: 'os-1',
      autorId: 'user-1',
      causa: 'Causa original',
      servicoFeito: 'Serviço original',
      pendencias: null,
      fechadoEm: null,
    };
    const painelB: PainelPayload = { ...PAINEL, companyUserId: 'user-2' };
    const s = new MecanicaService(prismaComLaudo([OS_INTERNA], laudoDeA));
    await expect(
      s.salvarLaudo(painelB, 'os-1', {
        causa: 'Causa atualizada',
        servicoFeito: 'Serviço atualizado',
        pendencias: null,
      }),
    ).resolves.toMatchObject({
      autorId: 'user-1',
      causa: 'Causa atualizada',
      servicoFeito: 'Serviço atualizado',
    });
  });
});

/**
 * Achado Important da revisão da Task 8: `concluir` só carimba `fechadoEm`
 * quando ele ainda está nulo (`if (!laudo.fechadoEm)`) — a data de fechamento
 * original tem que sobreviver a uma segunda chamada. Sem este teste, a
 * mutação "carimbar sempre" (remover o `if`) não derrubava teste nenhum.
 */
describe('MecanicaService.concluir — chamado duas vezes', () => {
  it('mantém fechadoEm original: concluir de novo não reescreve a data', async () => {
    const laudoAberto = {
      id: 'l-2',
      serviceOrderId: 'os-1',
      autorId: 'user-1',
      causa: 'Vazamento no cilindro',
      servicoFeito: 'Troca do retentor',
      pendencias: null,
      fechadoEm: null,
    };
    const prisma = prismaComLaudo([OS_INTERNA], laudoAberto);
    const s = new MecanicaService(prisma);

    await s.concluir(PAINEL, 'os-1', d('10:00'));
    await s.concluir(PAINEL, 'os-1', d('15:00'));

    const laudoFinal = await (
      prisma as {
        serviceOrderLaudo: {
          findUnique: (args: {
            where: { serviceOrderId: string };
          }) => Promise<{ fechadoEm: Date | null } | null>;
        };
      }
    ).serviceOrderLaudo.findUnique({ where: { serviceOrderId: 'os-1' } });

    expect(laudoFinal?.fechadoEm).toEqual(d('10:00'));
  });
});

/**
 * Lição das Tasks 6/7: `salvarLaudo` e `concluir` chamam `detalhe(painel,
 * osId)` logo no início — é isso que impede escrever laudo ou concluir OS de
 * outra empresa ou de pregão. Sem um teste que prove essa chamada, removê-la
 * deixaria a suíte inteira verde.
 */
describe('MecanicaService — laudo e conclusão — posse/empresa', () => {
  const OS_OUTRA_EMPRESA = {
    id: 'os-outra-empresa',
    companyId: 'empresa-2',
    execucao: 'interna',
    situacao: 'Aberta',
  };
  const OS_PARCEIRA = {
    id: 'os-parceira',
    companyId: 'empresa-1',
    execucao: 'parceira',
    situacao: 'Aberta',
  };
  const DADOS_LAUDO = { causa: 'x', servicoFeito: 'y', pendencias: null };

  it('404 ao salvar laudo em OS de outra empresa', async () => {
    const s = new MecanicaService(prismaComLaudo([OS_OUTRA_EMPRESA], null));
    await expect(
      s.salvarLaudo(PAINEL, 'os-outra-empresa', DADOS_LAUDO),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('404 ao salvar laudo em OS parceira — não existe para este módulo', async () => {
    const s = new MecanicaService(prismaComLaudo([OS_PARCEIRA], null));
    await expect(
      s.salvarLaudo(PAINEL, 'os-parceira', DADOS_LAUDO),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('404 ao concluir OS de outra empresa', async () => {
    const s = new MecanicaService(prismaComLaudo([OS_OUTRA_EMPRESA], null));
    await expect(s.concluir(PAINEL, 'os-outra-empresa')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('404 ao concluir OS parceira — não existe para este módulo', async () => {
    const s = new MecanicaService(prismaComLaudo([OS_PARCEIRA], null));
    await expect(s.concluir(PAINEL, 'os-parceira')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
