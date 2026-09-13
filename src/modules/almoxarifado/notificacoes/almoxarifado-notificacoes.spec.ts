import {
  enviarNotificacoes,
  montarNotificacaoKitCompleto,
  montarNotificacaoOsLiberada,
  usuariosDoAlmoxarifado,
  type NotificacaoPronta,
} from './almoxarifado-notificacoes';

const COMPANY = '11111111-1111-1111-1111-111111111111';
const OUTRA_COMPANY = '99999999-9999-9999-9999-999999999999';

/**
 * `tx` fake para os testes de FORMA da mensagem (Step 1 original da Task 8,
 * adaptado à rodada 2): mocks fixos, ignoram o `where`. A cobertura do
 * `where` em si — o achado Important I2 — está nos describes mais abaixo,
 * com fakes que de fato filtram.
 */
function tx() {
  return {
    company: { findUnique: jest.fn().mockResolvedValue({ legacyId: 'leg-1' }) },
    operator: { findFirst: jest.fn().mockResolvedValue({ companyUserId: 'user-mec' }) },
    // Achado minor m3 da revisão: `findMany`, não `findFirst` — um
    // equipamento pode ter mais de um programador cadastrado.
    equipmentProgramador: { findMany: jest.fn().mockResolvedValue([{ companyUserId: 'user-prog' }]) },
  };
}

describe('montarNotificacaoOsLiberada', () => {
  it('avisa mecânico E programador, sem repetir quando são a mesma pessoa', async () => {
    const t = tx();
    t.equipmentProgramador.findMany.mockResolvedValue([{ companyUserId: 'user-mec' }]);
    const linhas = await montarNotificacaoOsLiberada(t as never, {
      companyId: COMPANY, serviceOrderId: 'os-1', protocolo: 'OS-2026-047',
      equipmentNome: 'ESC-014', responsavelOperatorId: 'op-1', equipmentId: 'eq-1',
      local: 'Almoxarifado Central',
    });
    expect(linhas).toHaveLength(1);
  });

  it('a mensagem diz onde retirar — sem isso o mecânico não sabe para onde ir', async () => {
    const t = tx();
    const linhas = await montarNotificacaoOsLiberada(t as never, {
      companyId: COMPANY, serviceOrderId: 'os-1', protocolo: 'OS-2026-047',
      equipmentNome: 'ESC-014', responsavelOperatorId: 'op-1', equipmentId: 'eq-1',
      local: 'Almoxarifado Central',
    });
    const linha = linhas[0];
    expect(linha.mensagem).toContain('Almoxarifado Central');
    expect(linha.mensagem).toContain('ESC-014');
    expect(linha.referenciaTipo).toBe('service_order');
  });

  it('OS sem mecânico e sem programador não monta nada, em vez de quebrar', async () => {
    const t = tx();
    t.operator.findFirst.mockResolvedValue(null);
    t.equipmentProgramador.findMany.mockResolvedValue([]);
    const linhas = await montarNotificacaoOsLiberada(t as never, {
      companyId: COMPANY, serviceOrderId: 'os-1', protocolo: 'OS-2026-047',
      equipmentNome: 'ESC-014', responsavelOperatorId: null, equipmentId: 'eq-1',
      local: 'Almoxarifado Central',
    });
    expect(linhas).toHaveLength(0);
    // Sem destinatário nenhum, `montarLinhas` nem chega a olhar `company`
    // (achado (a) da revisão anterior, ainda válido aqui).
    expect(t.company.findUnique).not.toHaveBeenCalled();
  });

  it('avisa TODOS os programadores do equipamento, não só um (achado minor m3)', async () => {
    // `EquipmentProgramador` tem `@@unique([equipmentId, companyUserId])`:
    // um equipamento pode ter mais de um. `findFirst` avisaria só um,
    // escolhido pelo plano do Postgres — não determinístico.
    const t = tx();
    t.operator.findFirst.mockResolvedValue(null);
    t.equipmentProgramador.findMany.mockResolvedValue([
      { companyUserId: 'user-prog-1' },
      { companyUserId: 'user-prog-2' },
    ]);
    const linhas = await montarNotificacaoOsLiberada(t as never, {
      companyId: COMPANY, serviceOrderId: 'os-1', protocolo: 'OS-2026-047',
      equipmentNome: 'ESC-014', responsavelOperatorId: null, equipmentId: 'eq-1',
      local: 'Almoxarifado Central',
    });
    expect(linhas.map((l) => l.destinatarioId).sort()).toEqual(['user-prog-1', 'user-prog-2']);
  });
});

describe('montarNotificacaoKitCompleto', () => {
  it('avisa quem tem acesso ao almoxarifado, citando a OS', async () => {
    const t = tx();
    const linhas = await montarNotificacaoKitCompleto(t as never, {
      companyId: COMPANY, requisicaoId: 'req-1', numero: 'REQ-2026-001',
      protocolo: 'OS-2026-047', destinatarios: ['user-almox'],
    });
    const linha = linhas[0];
    expect(linha.destinatarioId).toBe('user-almox');
    expect(linha.mensagem).toContain('REQ-2026-001');
    expect(linha.referenciaTipo).toBe('requisicao_material');
  });
});

describe('enviarNotificacoes (achado Important I4 da rodada 2)', () => {
  const linhaPronta: NotificacaoPronta = {
    companyId: COMPANY, destinatarioTipo: 'company_user', destinatarioId: 'user-1',
    prefeituraLegacyId: 'leg-1', titulo: 'Título', mensagem: 'Mensagem',
    tipo: 'info', referenciaTipo: 'service_order', referenciaId: 'os-1',
  };

  it('grava as linhas já montadas, com o client recebido (nunca `tx`)', async () => {
    const prisma = { notificacao: { createMany: jest.fn().mockResolvedValue({ count: 1 }) } };
    await enviarNotificacoes(prisma as never, [linhaPronta]);
    expect(prisma.notificacao.createMany).toHaveBeenCalledWith({ data: [linhaPronta] });
  });

  it('lista vazia não toca no banco', async () => {
    const prisma = { notificacao: { createMany: jest.fn() } };
    await enviarNotificacoes(prisma as never, []);
    expect(prisma.notificacao.createMany).not.toHaveBeenCalled();
  });

  it('NUNCA LANÇA — uma falha de INSERT (ex.: 42501 de RLS) vira log, não erro', async () => {
    const erro = new Error('permission denied for table notificacoes (42501)');
    const prisma = { notificacao: { createMany: jest.fn().mockRejectedValue(erro) } };
    const logSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    await expect(enviarNotificacoes(prisma as never, [linhaPronta])).resolves.toBeUndefined();
    expect(logSpy).toHaveBeenCalled();
    logSpy.mockRestore();
  });
});

/**
 * Achado Important I2 da rodada 2: os mocks acima (e os das specs de
 * `entrega`/`separacao-servico`) ignoram o `where` — remover `enabled: true`
 * ou `companyId` é type-válido e passa. Os fakes abaixo aplicam de verdade os
 * predicados do `where` sobre um conjunto de linhas plantado, para que
 * remover um filtro do código de produção mude o resultado do teste.
 */
describe('usuariosDoAlmoxarifado — isolamento e filtros (achado Important I2)', () => {
  /**
   * Cinco linhas plantadas, cada uma excluída por um filtro DIFERENTE — só
   * a combinação de TODOS os filtros corretos deixa exatamente
   * `'user-ok'`:
   * (1) cargo desta empresa, grupo `almoxarifado` HABILITADO — inclui;
   * (2) cargo desta empresa, linha do grupo criada e DESLIGADA — exclui
   *     (por `enabled: true`);
   * (3) cargo desta empresa, `ativo: false` — exclui (por `ativo: true`);
   * (4) operador de OUTRA empresa, com o cargo (1) — exclui (por `companyId`
   *     do `operator.findMany`);
   * (5) operador desta empresa, cargo (1), `companyUserId: null` — exclui
   *     (por `companyUserId: { not: null }`).
   */
  // Cada cargo/operador "ruim" abaixo tem um PAR: um cargo excluído só pelo
  // filtro que ele testa, e um operador vinculado A ELE — sem o operador,
  // remover o filtro do cargo não mudaria o resultado (o cargo espúrio
  // entraria em `cargos`, mas nenhum operador o referenciaria). Um filtro
  // AUSENTE no `where` é tratado como SEM RESTRIÇÃO (`undefined` = passa
  // tudo), igual ao Prisma real — é isso que faz cada mutação VAZAR uma
  // linha a mais, em vez de zerar o resultado por acidente.
  function montarTxFiltrante() {
    const cargos = [
      { id: 'cargo-ok', companyId: COMPANY, ativo: true, enabled: true },
      { id: 'cargo-desligado', companyId: COMPANY, ativo: true, enabled: false },
      { id: 'cargo-inativo', companyId: COMPANY, ativo: false, enabled: true },
      { id: 'cargo-outra-empresa', companyId: OUTRA_COMPANY, ativo: true, enabled: true },
    ];
    const operadores = [
      { companyUserId: 'user-ok', companyId: COMPANY, companyRoleId: 'cargo-ok' },
      // Vinculados aos cargos "ruins" — só aparecem no resultado se o filtro
      // correspondente do CARGO for removido.
      { companyUserId: 'user-do-cargo-desligado', companyId: COMPANY, companyRoleId: 'cargo-desligado' },
      { companyUserId: 'user-do-cargo-inativo', companyId: COMPANY, companyRoleId: 'cargo-inativo' },
      { companyUserId: 'user-do-cargo-de-outra-empresa', companyId: COMPANY, companyRoleId: 'cargo-outra-empresa' },
      // Excluídos pelo próprio filtro do OPERADOR, não do cargo.
      { companyUserId: 'user-outra-empresa-mesmo-cargo', companyId: OUTRA_COMPANY, companyRoleId: 'cargo-ok' },
      { companyUserId: null, companyId: COMPANY, companyRoleId: 'cargo-ok' },
    ];
    return {
      companyRole: {
        findMany: jest.fn(async ({ where }: {
          where: {
            companyId?: string; ativo?: boolean;
            accessGroups?: { some: { enabled?: boolean; group: { key: string } } };
          };
        }) =>
          cargos
            .filter((c) => where.companyId === undefined || c.companyId === where.companyId)
            .filter((c) => where.ativo === undefined || c.ativo === where.ativo)
            .filter((c) => where.accessGroups?.some.group.key === 'almoxarifado')
            .filter((c) => where.accessGroups?.some.enabled === undefined || c.enabled === where.accessGroups.some.enabled)
            .map((c) => ({ id: c.id })),
        ),
      },
      operator: {
        findMany: jest.fn(async ({ where }: {
          where: { companyId?: string; companyRoleId: { in: string[] }; companyUserId?: { not: null } };
        }) =>
          operadores
            .filter((o) => where.companyId === undefined || o.companyId === where.companyId)
            .filter((o) => where.companyRoleId.in.includes(o.companyRoleId))
            .filter((o) => where.companyUserId === undefined || o.companyUserId !== null)
            .map((o) => ({ companyUserId: o.companyUserId })),
        ),
      },
    };
  }

  it('devolve só o operador da empresa certa, com cargo ativo, grupo habilitado e login no painel', async () => {
    const t = montarTxFiltrante();
    const r = await usuariosDoAlmoxarifado(t as never, COMPANY);
    expect(r).toEqual(['user-ok']);
  });

  it('empresa sem nenhum cargo com acesso ao grupo não notifica ninguém', async () => {
    const t = montarTxFiltrante();
    const r = await usuariosDoAlmoxarifado(t as never, OUTRA_COMPANY);
    expect(r).toEqual([]);
  });
});

/**
 * Mesma lógica do I2 para os dois `findFirst`/`findMany` de
 * `montarNotificacaoOsLiberada`: fakes que aplicam o `where` sobre linhas
 * plantadas de OUTRA empresa, provando o isolamento por tenant.
 */
describe('montarNotificacaoOsLiberada — isolamento por empresa (achado Important I2)', () => {
  it('mecânico de OUTRA empresa não vira destinatário mesmo com o `operatorId` certo', async () => {
    // Um segundo operador com o MESMO id, na empresa certa, é o que faz a
    // mutação "tirar `companyId` do `where`" ser detectável: sem ele, um
    // `find` sem filtro de empresa continuaria achando só o `op-1` errado
    // (o certo simplesmente não existiria) e o teste passaria por acidente.
    const operadoresPlantados = [
      { id: 'op-1', companyId: OUTRA_COMPANY, companyUserId: 'user-mec-outra-empresa' },
      { id: 'op-1', companyId: COMPANY, companyUserId: 'user-mec-certo' },
    ];
    const t = {
      operator: {
        // `where.companyId` ausente = SEM RESTRIÇÃO (semântica real do
        // Prisma) — é isso que faz remover o filtro de produção VAZAR o
        // operador errado, em vez de simplesmente não achar nenhum.
        findFirst: jest.fn(async ({ where }: { where: { id: string; companyId?: string } }) =>
          operadoresPlantados.find(
            (o) => o.id === where.id && (where.companyId === undefined || o.companyId === where.companyId),
          ) ?? null,
        ),
      },
      equipmentProgramador: { findMany: jest.fn().mockResolvedValue([]) },
      company: { findUnique: jest.fn().mockResolvedValue({ legacyId: 'leg-1' }) },
    };
    const linhas = await montarNotificacaoOsLiberada(t as never, {
      companyId: COMPANY, serviceOrderId: 'os-1', protocolo: 'OS-2026-047',
      equipmentNome: null, equipmentId: null, responsavelOperatorId: 'op-1',
      local: 'Almoxarifado Central',
    });
    // Notifica o operador da EMPRESA CERTA, nunca o homônimo de outra —
    // com o filtro de produção removido, `find` (ordem do array) devolveria
    // o de `OUTRA_COMPANY` em vez deste.
    expect(linhas.map((l) => l.destinatarioId)).toEqual(['user-mec-certo']);
  });

  it('programador de um equipamento de OUTRA empresa não vira destinatário mesmo com o `equipmentId` certo', async () => {
    // Mesmo raciocínio: um segundo programador, MESMO `equipmentId`, mas no
    // equipamento da empresa certa — sem ele, "tirar o filtro de empresa"
    // não vazaria nada (o programador certo não existiria para achar).
    const programadoresPlantados = [
      { equipmentId: 'eq-1', equipmentCompanyId: OUTRA_COMPANY, companyUserId: 'user-prog-outra-empresa' },
      { equipmentId: 'eq-1', equipmentCompanyId: COMPANY, companyUserId: 'user-prog-certo' },
    ];
    const t = {
      operator: { findFirst: jest.fn().mockResolvedValue(null) },
      equipmentProgramador: {
        // `where.equipment` ausente = SEM RESTRIÇÃO de empresa (semântica
        // real do Prisma) — isso é o que faz a mutação vazar o programador
        // da empresa errada, em vez de simplesmente não achar ninguém.
        findMany: jest.fn(async ({ where }: {
          where: { equipmentId: string; equipment?: { companyId: string } };
        }) =>
          programadoresPlantados
            .filter((p) => p.equipmentId === where.equipmentId)
            .filter((p) => where.equipment === undefined || p.equipmentCompanyId === where.equipment.companyId)
            .map((p) => ({ companyUserId: p.companyUserId })),
        ),
      },
      company: { findUnique: jest.fn().mockResolvedValue({ legacyId: 'leg-1' }) },
    };
    const linhas = await montarNotificacaoOsLiberada(t as never, {
      companyId: COMPANY, serviceOrderId: 'os-1', protocolo: 'OS-2026-047',
      equipmentNome: null, equipmentId: 'eq-1', responsavelOperatorId: null,
      local: 'Almoxarifado Central',
    });
    expect(linhas.map((l) => l.destinatarioId)).toEqual(['user-prog-certo']);
  });
});
