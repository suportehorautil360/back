import { NotFoundException, ConflictException } from '@nestjs/common';
import { ChecklistChassiService } from './checklist-chassi.service';
import type { FirebaseService } from '../../config/firebase.service';

// ---------------------------------------------------------------
// Helpers para montar o mock do Firestore
// ---------------------------------------------------------------

type EqDoc = { id: string; prefeituraId: string; chassis: string };
type CliDoc = { id: string; nome: string; checklistLoginChassi?: boolean };

function makeDoc(id: string, data: Record<string, unknown>, exists = true) {
  return {
    id,
    exists,
    get: (field: string) => data[field],
    data: () => data,
  };
}

function makeFirestore(equipamentos: EqDoc[], clientes: CliDoc[]) {
  const eqDocs = equipamentos.map((e) =>
    makeDoc(e.id, { prefeituraId: e.prefeituraId, chassis: e.chassis }),
  );

  const cliMap = new Map(
    clientes
      .map((c) =>
        makeDoc(c.id, {
          nome: c.nome,
          checklistLogin:
            c.checklistLoginChassi !== undefined
              ? { chassi: c.checklistLoginChassi }
              : undefined,
        }),
      )
      .map((d) => [d.id, d]),
  );

  return {
    getFirestore: () => ({
      collection: (name: string) => {
        if (name === 'equipamentos') {
          return {
            where: jest.fn(() => ({
              limit: jest.fn(() => ({
                get: jest.fn().mockResolvedValue({
                  empty: eqDocs.length === 0,
                  docs: eqDocs,
                }),
              })),
            })),
          };
        }
        if (name === 'clientes') {
          return {
            doc: jest.fn((id: string) => ({
              get: jest
                .fn()
                .mockResolvedValue(cliMap.get(id) ?? makeDoc(id, {}, false)),
            })),
          };
        }
        return {};
      },
    }),
  } as unknown as FirebaseService;
}

function makeService(equipamentos: EqDoc[], clientes: CliDoc[]) {
  return new ChecklistChassiService(makeFirestore(equipamentos, clientes));
}

// ---------------------------------------------------------------
// Testes
// ---------------------------------------------------------------

describe('ChecklistChassiService.resolverChassi', () => {
  it('encontrou 1 equipamento, empresa habilita chassi → retorna dados', async () => {
    const service = makeService(
      [{ id: 'eq_1', prefeituraId: 'cli_1', chassis: '9BD196341A0000123' }],
      [{ id: 'cli_1', nome: 'Prefeitura X', checklistLoginChassi: true }],
    );

    const out = await service.resolverChassi('9bd196341a0000123');
    expect(out).toEqual({
      empresaId: 'cli_1',
      empresaNome: 'Prefeitura X',
      idMaquina: 'eq_1',
      chassi: '9BD196341A0000123',
    });
  });

  it('nenhum equipamento → NotFoundException', async () => {
    const service = makeService([], []);
    await expect(service.resolverChassi('XXX')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('empresa NÃO habilita chassi → NotFoundException (mensagem específica)', async () => {
    const service = makeService(
      [{ id: 'eq_2', prefeituraId: 'cli_2', chassis: 'YYY' }],
      [{ id: 'cli_2', nome: 'Empresa Y', checklistLoginChassi: false }],
    );
    await expect(service.resolverChassi('YYY')).rejects.toThrow(/não habilita/);
  });

  it('campo checklistLogin ausente → NotFoundException (mensagem específica)', async () => {
    const service = makeService(
      [{ id: 'eq_3', prefeituraId: 'cli_3', chassis: 'ZZZ' }],
      [{ id: 'cli_3', nome: 'Empresa Z' }],
    );
    await expect(service.resolverChassi('ZZZ')).rejects.toThrow(/não habilita/);
  });

  it('2+ equipamentos em empresas distintas com chassi habilitado → ConflictException', async () => {
    const service = makeService(
      [
        { id: 'eq_a', prefeituraId: 'cli_a', chassis: 'DUP' },
        { id: 'eq_b', prefeituraId: 'cli_b', chassis: 'DUP' },
      ],
      [
        { id: 'cli_a', nome: 'Empresa A', checklistLoginChassi: true },
        { id: 'cli_b', nome: 'Empresa B', checklistLoginChassi: true },
      ],
    );
    await expect(service.resolverChassi('DUP')).rejects.toThrow(
      ConflictException,
    );
  });
});
