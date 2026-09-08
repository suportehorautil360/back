import { NotFoundException, ConflictException } from '@nestjs/common';
import { ChecklistChassiService } from './checklist-chassi.service';

// ---------------------------------------------------------------
// Stub do Prisma
//
// Este arquivo testava o Firestore até a migração para Postgres
// (2026-08-16). O serviço passou a receber `PrismaService` no lugar do
// `FirebaseService` e os testes ficaram passando um Firestore para o
// parâmetro do Prisma — compilando por causa do cast, e falhando os oito em
// `this.prisma.equipment is undefined`. Reescritos aqui para o formato real.
//
// O stub FILTRA de verdade em vez de devolver uma lista fixa: as duas
// consultas de `resolverChassi` (exata e case-insensitive) só se distinguem
// pelo `where`, e um stub que ignora o `where` não saberia dizer qual das
// duas achou o equipamento.
// ---------------------------------------------------------------

/**
 * PKs são UUID de verdade porque o serviço passa o `empresaId` por `tryUuid`
 * antes de consultar — string que não seja UUID vira o UUID-zero (o Postgres
 * recusa qualquer outra coisa numa coluna `uuid`). Com uma PK falsa do tipo
 * "company-uuid-1", o teste da busca pela PK falharia sem que houvesse bug.
 */
const COMPANY_PK = '11111111-1111-1111-1111-111111111111';
const EQ_PK = '22222222-2222-2222-2222-222222222222';

type EmpresaStub = {
  id: string;
  name: string;
  legacyId: string | null;
  /** `{ chassi: true }` habilita o login por chassi. */
  checklistLogin: { chassi?: boolean } | null;
};

type EquipamentoStub = {
  id: string;
  legacyId: string | null;
  chassi: string | null;
  companyId: string;
  company: EmpresaStub | null;
};

type WhereChassi =
  | string
  | { equals?: string; mode?: string; not?: null }
  | undefined;

type WhereFindMany = {
  chassi?: WhereChassi;
  companyId?: string;
  OR?: { companyId?: string; company?: { legacyId?: string } }[];
};

function equipamento(over: Partial<EquipamentoStub> = {}): EquipamentoStub {
  return {
    id: EQ_PK,
    legacyId: 'eq-legacy-1',
    chassi: '9BD196341A0000123',
    companyId: COMPANY_PK,
    company: empresa(),
    ...over,
  };
}

function empresa(over: Partial<EmpresaStub> = {}): EmpresaStub {
  return {
    id: COMPANY_PK,
    name: 'Prefeitura X',
    legacyId: 'company-legacy-1',
    checklistLogin: { chassi: true },
    ...over,
  };
}

function makePrisma(equipamentos: EquipamentoStub[]) {
  const findMany = jest.fn(
    (args: { where?: WhereFindMany; take?: number }) => {
      const where = args.where ?? {};
      let linhas = equipamentos;

      if (typeof where.chassi === 'string') {
        // Consulta exata.
        const alvo = where.chassi;
        linhas = linhas.filter((e) => e.chassi === alvo);
      } else if (where.chassi && typeof where.chassi === 'object') {
        if (typeof where.chassi.equals === 'string') {
          // Consulta case-insensitive (o fallback).
          const alvo = where.chassi.equals.toUpperCase();
          linhas = linhas.filter((e) => (e.chassi ?? '').toUpperCase() === alvo);
        }
        if (where.chassi.not === null) {
          linhas = linhas.filter((e) => e.chassi !== null);
        }
      }

      // `companyId` solto precisa ser respeitado, e não só o `OR`: sem isto o
      // stub devolve tudo para uma consulta recortada, e um `where` que
      // perdesse o ramo do legacyId passaria despercebido.
      if (where.companyId !== undefined) {
        const alvo = where.companyId;
        linhas = linhas.filter((e) => e.companyId === alvo);
      }

      if (where.OR) {
        const clausulas = where.OR;
        linhas = linhas.filter((e) =>
          clausulas.some((c) =>
            c.companyId !== undefined
              ? c.companyId === e.companyId
              : c.company?.legacyId !== undefined
                ? c.company.legacyId === e.company?.legacyId
                : false,
          ),
        );
      }

      return Promise.resolve(
        args.take ? linhas.slice(0, args.take) : linhas,
      );
    },
  );

  const prisma = { equipment: { findMany } };
  return {
    prisma: prisma as unknown as ConstructorParameters<
      typeof ChecklistChassiService
    >[0],
    findMany,
  };
}

function makeService(equipamentos: EquipamentoStub[]) {
  return new ChecklistChassiService(makePrisma(equipamentos).prisma);
}

// ---------------------------------------------------------------
// Testes
// ---------------------------------------------------------------

describe('ChecklistChassiService.resolverChassi', () => {
  it('acha o equipamento e devolve empresa, máquina e chassi normalizado', async () => {
    const service = makeService([equipamento()]);

    // Minúsculo de propósito: o operador digita como quiser.
    const out = await service.resolverChassi('9bd196341a0000123');

    expect(out).toEqual({
      empresaId: 'company-legacy-1',
      empresaNome: 'Prefeitura X',
      idMaquina: 'eq-legacy-1',
      chassi: '9BD196341A0000123',
    });
  });

  it('sem legacyId, cai na PK do Postgres', async () => {
    // Empresa e equipamento criados já no Postgres, sem passado no Firestore.
    // O app guarda o que vier aqui e usa nas rotas seguintes — se este ramo
    // devolvesse vazio, o login funcionaria e tudo depois falharia.
    const service = makeService([
      equipamento({ legacyId: null, company: empresa({ legacyId: null }) }),
    ]);

    const out = await service.resolverChassi('9BD196341A0000123');

    expect(out.empresaId).toBe(COMPANY_PK);
    expect(out.idMaquina).toBe(EQ_PK);
  });

  it('chassi gravado em case diferente é achado pela consulta de reserva', async () => {
    // Equipamento migrado do Firestore com o chassi em minúsculo. A consulta
    // exata não acha e existe uma segunda, case-insensitive, só para isto —
    // sem teste, alguém a removeria por parecer redundante.
    const { prisma, findMany } = makePrisma([
      equipamento({ chassi: '9bd196341a0000123' }),
    ]);
    const service = new ChecklistChassiService(prisma);

    const out = await service.resolverChassi('9BD196341A0000123');

    expect(out.idMaquina).toBe('eq-legacy-1');
    // Duas consultas: a exata volta vazia, a de reserva acha.
    expect(findMany).toHaveBeenCalledTimes(2);
  });

  it('chassi vazio nem consulta o banco', async () => {
    const { prisma, findMany } = makePrisma([equipamento()]);
    const service = new ChecklistChassiService(prisma);

    await expect(service.resolverChassi('   ')).rejects.toThrow(
      NotFoundException,
    );
    expect(findMany).not.toHaveBeenCalled();
  });

  it('nenhum equipamento com esse chassi → NotFoundException', async () => {
    const service = makeService([]);
    await expect(service.resolverChassi('XXX')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('empresa que NÃO habilita chassi é recusada com mensagem própria', async () => {
    // A distinção importa para o operador: "chassi não encontrado" o faz
    // conferir o número na máquina; "a empresa não habilita" o manda falar
    // com o gestor.
    const service = makeService([
      equipamento({ company: empresa({ checklistLogin: { chassi: false } }) }),
    ]);
    await expect(service.resolverChassi('9BD196341A0000123')).rejects.toThrow(
      /não habilita/,
    );
  });

  it('checklistLogin ausente conta como NÃO habilitado', async () => {
    // Empresa que nunca configurou o login. O default é fechado: habilitar
    // por omissão abriria o app de uma empresa para quem souber um chassi.
    const service = makeService([
      equipamento({ company: empresa({ checklistLogin: null }) }),
    ]);
    await expect(service.resolverChassi('9BD196341A0000123')).rejects.toThrow(
      /não habilita/,
    );
  });

  it('equipamento sem empresa não derruba a rota', async () => {
    // O serviço escreve `e.company?.checklistLogin` de propósito. Sem a
    // guarda seria TypeError, e o operador veria erro 500 em vez de uma
    // mensagem — este teste é o que segura o `?.`.
    const service = makeService([equipamento({ company: null })]);
    await expect(service.resolverChassi('9BD196341A0000123')).rejects.toThrow(
      /não habilita/,
    );
  });

  it('mesmo chassi em duas empresas habilitadas → ConflictException', async () => {
    // Não dá para escolher por conta própria de quem é a máquina: entrar na
    // empresa errada mandaria o checklist e o ponto para o cliente errado.
    const service = makeService([
      equipamento({ id: 'eq-a', legacyId: 'a', companyId: 'c-a', company: empresa({ id: 'c-a', legacyId: 'ca' }) }),
      equipamento({ id: 'eq-b', legacyId: 'b', companyId: 'c-b', company: empresa({ id: 'c-b', legacyId: 'cb' }) }),
    ]);
    await expect(service.resolverChassi('9BD196341A0000123')).rejects.toThrow(
      ConflictException,
    );
  });

  it('mesmo chassi duplicado na MESMA empresa não é conflito', async () => {
    // Cadastro duplicado acontece. O conflito é sobre não saber de QUEM é a
    // máquina; com uma empresa só, a resposta é a mesma pelos dois registros.
    const service = makeService([
      equipamento({ id: 'eq-a', legacyId: 'a' }),
      equipamento({ id: 'eq-b', legacyId: 'b' }),
    ]);

    const out = await service.resolverChassi('9BD196341A0000123');
    expect(out.empresaId).toBe('company-legacy-1');
  });
});

describe('ChecklistChassiService.listarChassisDaEmpresa', () => {
  it('devolve os chassis normalizados, sem repetir', async () => {
    // A lista vai para o cache do aparelho e é o que permite o login por
    // chassi offline. Duplicata viraria opção repetida; case misturado faria
    // o mesmo chassi não casar com o que o operador digita.
    const service = makeService([
      equipamento({ id: '1', chassi: 'aaa' }),
      equipamento({ id: '2', chassi: 'BBB' }),
      equipamento({ id: '3', chassi: 'aaa' }),
      equipamento({ id: '4', chassi: '   ' }),
    ]);

    const out = await service.listarChassisDaEmpresa('company-legacy-1');

    expect(out.chassis.sort()).toEqual(['AAA', 'BBB']);
    expect(new Date(out.expiraEm).getTime()).toBeGreaterThan(Date.now());
  });

  it('acha a empresa pelo legacyId E pela PK', async () => {
    // O aparelho guarda `empresaId` como veio de `resolverChassi`, que é o
    // legacyId quando existe. Procurar só pela PK deixaria o cache de chassis
    // vazio para toda empresa migrada do legado.
    const service = makeService([equipamento({ chassi: 'AAA' })]);

    expect(
      (await service.listarChassisDaEmpresa('company-legacy-1')).chassis,
    ).toEqual(['AAA']);
    expect(
      (await service.listarChassisDaEmpresa(COMPANY_PK)).chassis,
    ).toEqual(['AAA']);
  });

  it('empresa sem equipamento devolve lista vazia, não erro', async () => {
    // Empresa nova, ainda sem frota cadastrada. A tela de login trata lista
    // vazia; erro aqui a deixaria sem saída.
    const service = makeService([]);
    const out = await service.listarChassisDaEmpresa('company-legacy-1');

    expect(out.chassis).toEqual([]);
    expect(new Date(out.expiraEm).getTime()).toBeGreaterThan(Date.now());
  });
});

describe('ChecklistChassiService.empregadorDaEmpresa', () => {
  function servicoCom(company: Record<string, unknown> | null) {
    const findFirst = jest.fn().mockResolvedValue(company);
    const prisma = { company: { findFirst } };
    const s = new ChecklistChassiService(prisma as never);
    return { s, findFirst };
  }

  it('acha a empresa pelo legacyId do Firestore, não só pela PK', async () => {
    // O aparelho guarda `empresaId` como o docId do Firestore (é o que o
    // login por chassi devolve). Procurar só por `id` faria o comprovante
    // sair sem empregador para toda empresa migrada do legado.
    const { s, findFirst } = servicoCom({
      razaoSocial: 'VRENTAL LOCACOES LTDA',
      name: 'VRENTAL LTDA',
      cnpj: '12345678000199',
      caepf: null,
      cidade: 'Rio Claro',
      uf: 'SP',
    });

    await s.empregadorDaEmpresa('docId-do-firestore');

    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: [
            // `tryUuid` devolve o UUID-zero quando o id não é UUID: o Postgres
            // recusa string qualquer numa coluna uuid.
            { id: '00000000-0000-0000-0000-000000000000' },
            { legacyId: 'docId-do-firestore' },
          ],
        }),
      }),
    );
  });

  it('devolve os seis campos que o comprovante da Portaria 671 exige', async () => {
    const { s } = servicoCom({
      razaoSocial: 'VRENTAL LOCACOES LTDA',
      name: 'VRENTAL LTDA',
      cnpj: '12345678000199',
      caepf: null,
      cidade: 'Rio Claro',
      uf: 'SP',
    });

    expect(await s.empregadorDaEmpresa('x')).toEqual({
      razaoSocial: 'VRENTAL LOCACOES LTDA',
      name: 'VRENTAL LTDA',
      cnpj: '12345678000199',
      caepf: null,
      cidade: 'Rio Claro',
      uf: 'SP',
    });
  });

  it('empresa inexistente é 404, não objeto vazio', async () => {
    // Vazio silencioso viraria um comprovante com "Não informado" em tudo, e
    // o operador não teria como saber que o problema é o id, não o cadastro.
    const { s } = servicoCom(null);
    await expect(s.empregadorDaEmpresa('nao-existe')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
