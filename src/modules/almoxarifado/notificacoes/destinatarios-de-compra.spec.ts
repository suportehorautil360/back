import { aprovadoresDeCompra, usuariosDoGrupo } from './almoxarifado-notificacoes';

const COMPANY = '11111111-1111-1111-1111-111111111111';
const OUTRA = '22222222-2222-2222-2222-222222222222';

describe('aprovadoresDeCompra', () => {
  /**
   * Fake que implementa o `where` de verdade (empresa, status e o `OR` de papel
   * ou gestor master). Cada linha plantada só é excluída pelo pedaço certo do
   * filtro — tirar qualquer um deles faz uma delas vazar.
   */
  function txFalso() {
    const usuarios = [
      { id: 'owner', companyId: COMPANY, role: 'OWNER', status: 'ACTIVE' },
      { id: 'admin', companyId: COMPANY, role: 'ADMIN', status: 'ACTIVE' },
      { id: 'gestor', companyId: COMPANY, role: 'MEMBER', status: 'ACTIVE' },
      { id: 'membro', companyId: COMPANY, role: 'MEMBER', status: 'ACTIVE' },
      { id: 'admin-inativo', companyId: COMPANY, role: 'ADMIN', status: 'INACTIVE' },
      { id: 'owner-de-fora', companyId: OUTRA, role: 'OWNER', status: 'ACTIVE' },
    ];
    type Where = {
      companyId?: string;
      status?: string;
      OR?: Array<{ role?: { in: string[] }; id?: string }>;
    };
    return {
      companyUser: {
        findMany: jest.fn(async ({ where }: { where: Where }) =>
          usuarios
            .filter((u) => where.companyId === undefined || u.companyId === where.companyId)
            .filter((u) => where.status === undefined || u.status === where.status)
            .filter((u) => !where.OR || where.OR.some((c) => (c.role ? c.role.in.includes(u.role) : c.id === u.id)))
            .map((u) => ({ id: u.id })),
        ),
      },
    };
  }

  it('sem gestor master: OWNER e ADMIN ativos desta empresa', async () => {
    const r = await aprovadoresDeCompra(txFalso() as never, COMPANY, null);
    expect(r.sort()).toEqual(['admin', 'owner']);
  });

  it('com gestor master: ele entra junto, mesmo sendo MEMBER', async () => {
    const r = await aprovadoresDeCompra(txFalso() as never, COMPANY, 'gestor');
    expect(r.sort()).toEqual(['admin', 'gestor', 'owner']);
  });

  it('gestor master que é de OUTRA empresa não recebe', async () => {
    const r = await aprovadoresDeCompra(txFalso() as never, COMPANY, 'owner-de-fora');
    expect(r.sort()).toEqual(['admin', 'owner']);
  });
});

describe('usuariosDoGrupo', () => {
  function txFalso() {
    const cargos = [
      { id: 'cargo-compras', companyId: COMPANY, ativo: true, grupos: [{ key: 'compras', enabled: true }] },
      { id: 'cargo-almox', companyId: COMPANY, ativo: true, grupos: [{ key: 'almoxarifado', enabled: true }] },
    ];
    const operadores = [
      { companyId: COMPANY, companyRoleId: 'cargo-compras', companyUserId: 'user-compras' },
      { companyId: COMPANY, companyRoleId: 'cargo-almox', companyUserId: 'user-almox' },
    ];
    return {
      companyRole: {
        findMany: jest.fn(async ({ where }: {
          where: { companyId: string; ativo: boolean; accessGroups: { some: { enabled: boolean; group: { key: string } } } };
        }) =>
          cargos
            .filter((c) => c.companyId === where.companyId && c.ativo === where.ativo)
            .filter((c) => c.grupos.some((g) => g.enabled === where.accessGroups.some.enabled && g.key === where.accessGroups.some.group.key))
            .map((c) => ({ id: c.id })),
        ),
      },
      operator: {
        findMany: jest.fn(async ({ where }: { where: { companyId: string; companyRoleId: { in: string[] } } }) =>
          operadores
            .filter((o) => o.companyId === where.companyId && where.companyRoleId.in.includes(o.companyRoleId))
            .map((o) => ({ companyUserId: o.companyUserId })),
        ),
      },
    };
  }

  it('compras devolve só quem tem o grupo compras', async () => {
    expect(await usuariosDoGrupo(txFalso() as never, COMPANY, 'compras')).toEqual(['user-compras']);
  });

  it('almoxarifado devolve só quem tem o grupo almoxarifado', async () => {
    expect(await usuariosDoGrupo(txFalso() as never, COMPANY, 'almoxarifado')).toEqual(['user-almox']);
  });
});
