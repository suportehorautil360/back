jest.mock('node:crypto', () => ({
  randomUUID: jest.fn().mockReturnValue('fixed-uuid'),
}));

import { BadRequestException, NotFoundException } from '@nestjs/common';
import { WorkFrontService } from './work-front.service';
import { FirebaseService } from '../../config/firebase.service';
import { CreateWorkFrontDto } from './dto/create-work-front.dto';

interface FirestoreStub {
  userDoc?: { exists: boolean; data: () => unknown };
  workFrontDocs?: { data: () => unknown; ref: object }[];
  setMock?: jest.Mock;
  updateMock?: jest.Mock;
  commitMock?: jest.Mock;
}

function makeFirestore({
  userDoc = { exists: true, data: () => ({ prefeituraId: 'pref1' }) },
  workFrontDocs = [{ data: () => ({ prefeituraId: 'pref1' }), ref: {} }],
  setMock = jest.fn().mockResolvedValue(undefined),
  updateMock = jest.fn(),
  commitMock = jest.fn().mockResolvedValue(undefined),
}: FirestoreStub = {}) {
  const firebase = {
    getFirestore: () => ({
      batch: () => ({ update: updateMock, commit: commitMock }),
      collection: (name: string) => {
        if (name === 'users') {
          return {
            doc: jest.fn(() => ({
              get: jest.fn().mockResolvedValue(userDoc),
            })),
          };
        }
        if (name === 'work-fronts') {
          return {
            doc: jest.fn(() => ({ set: setMock })),
            where: jest.fn(() => ({
              get: jest.fn().mockResolvedValue({
                empty: workFrontDocs.length === 0,
                docs: workFrontDocs,
              }),
            })),
          };
        }
        if (name === 'allocations') {
          return {
            where: jest.fn(() => ({
              get: jest.fn().mockResolvedValue({ docs: [] }),
            })),
          };
        }
        return {};
      },
    }),
  } as unknown as FirebaseService;

  return { firebase, setMock, updateMock };
}

const BASE_DTO: CreateWorkFrontDto = {
  name: 'Rodovia SP-310',
  prefeituraId: 'pref1',
  address: 'São Carlos, SP',
  responsible: 'Carlos Mendes',
  equipaments: [],
  status: 'Ativa',
  startDate: '2026-01-10T00:00:00.000Z',
};

beforeAll(() => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterAll(() => {
  jest.restoreAllMocks();
});

describe('WorkFrontService.create', () => {
  it('grava responsibleId quando o usuário é da mesma prefeitura', async () => {
    const { firebase, setMock } = makeFirestore();
    const service = new WorkFrontService(firebase);

    await service.create({ ...BASE_DTO, responsibleId: 'user-1' });

    expect(setMock).toHaveBeenCalledWith(
      expect.objectContaining({ responsibleId: 'user-1' }),
    );
  });

  it('responsibleId de outra prefeitura → BadRequest', async () => {
    const { firebase, setMock } = makeFirestore({
      userDoc: { exists: true, data: () => ({ prefeituraId: 'outra' }) },
    });
    const service = new WorkFrontService(firebase);

    await expect(
      service.create({ ...BASE_DTO, responsibleId: 'user-1' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(setMock).not.toHaveBeenCalled();
  });

  it('responsibleId inexistente → BadRequest', async () => {
    const { firebase, setMock } = makeFirestore({
      userDoc: { exists: false, data: () => null },
    });
    const service = new WorkFrontService(firebase);

    await expect(
      service.create({ ...BASE_DTO, responsibleId: 'fantasma' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(setMock).not.toHaveBeenCalled();
  });

  it('sem responsibleId cria normalmente (frente legada)', async () => {
    const { firebase, setMock } = makeFirestore();
    const service = new WorkFrontService(firebase);

    await service.create(BASE_DTO);

    expect(setMock).toHaveBeenCalledTimes(1);
    const [gravado] = setMock.mock.calls[0] as [Record<string, unknown>];
    expect(gravado).not.toHaveProperty('responsibleId');
  });
});

describe('WorkFrontService.update', () => {
  it('valida o responsibleId contra a prefeitura da frente, não do payload', async () => {
    const { firebase, updateMock } = makeFirestore({
      userDoc: { exists: true, data: () => ({ prefeituraId: 'outra' }) },
      workFrontDocs: [{ data: () => ({ prefeituraId: 'pref1' }), ref: {} }],
    });
    const service = new WorkFrontService(firebase);

    await expect(
      service.update('wf-1', { responsibleId: 'user-1' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(updateMock).not.toHaveBeenCalled();
  });

  it('grava responsibleId quando o usuário é da prefeitura da frente', async () => {
    const { firebase, updateMock } = makeFirestore();
    const service = new WorkFrontService(firebase);

    await service.update('wf-1', { responsibleId: 'user-1' });

    expect(updateMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ responsibleId: 'user-1' }),
    );
  });

  it('responsibleId vazio limpa o vínculo sem validar usuário', async () => {
    const { firebase, updateMock } = makeFirestore({
      userDoc: { exists: false, data: () => null },
    });
    const service = new WorkFrontService(firebase);

    await service.update('wf-1', { responsibleId: '' });

    expect(updateMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ responsibleId: '' }),
    );
  });

  it('frente inexistente → NotFound', async () => {
    const { firebase } = makeFirestore({ workFrontDocs: [] });
    const service = new WorkFrontService(firebase);

    await expect(service.update('sumiu', { name: 'x' })).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
