jest.mock('bcrypt', () => ({
  hash: jest.fn().mockResolvedValue('$2b$12$hashed'),
}));

jest.mock('node:crypto', () => ({
  randomUUID: jest.fn().mockReturnValue('fixed-uuid'),
}));

import { ConflictException, NotFoundException } from '@nestjs/common';
import { UsersService } from './users.service';
import { FirebaseService } from '../../config/firebase.service';

function makeFirestore({
  emailSnap = { empty: true, docs: [] as { data: () => unknown }[] },
  userDoc = { exists: false, data: () => null, id: '' },
  oficinasDoc = { exists: false, data: () => null, id: '' },
  setMock = jest.fn().mockResolvedValue(undefined),
} = {}) {
  return {
    getFirestore: () => ({
      collection: (name: string) => {
        if (name === 'users') {
          return {
            where: jest.fn(() => ({
              limit: jest.fn(() => ({
                get: jest.fn().mockResolvedValue(emailSnap),
              })),
            })),
            doc: jest.fn(() => ({
              set: setMock,
              get: jest.fn().mockResolvedValue(userDoc),
            })),
          };
        }
        if (name === 'oficinas') {
          return {
            doc: jest.fn(() => ({
              get: jest.fn().mockResolvedValue(oficinasDoc),
            })),
          };
        }
        return {};
      },
    }),
  } as unknown as FirebaseService;
}

beforeAll(() => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterAll(() => {
  jest.restoreAllMocks();
});

describe('UsersService.registerUser', () => {
  it('email duplicado → ConflictException', async () => {
    const firebase = makeFirestore({
      emailSnap: {
        empty: false,
        docs: [{ data: () => ({ email: 'dup@of.com' }) }],
      },
    });
    const service = new UsersService(firebase);

    await expect(
      service.registerUser({
        name: 'Test',
        email: 'dup@of.com',
        password: 'senha123',
        oficinaId: 'of-1',
        prefeituraId: 'pref-1',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('registro bem-sucedido → passwordHash ausente na resposta', async () => {
    const setMock = jest.fn().mockResolvedValue(undefined);
    const firebase = makeFirestore({ setMock });
    const service = new UsersService(firebase);

    const result = await service.registerUser({
      name: 'João Silva',
      email: 'joao@of.com',
      password: 'senhaSegura123',
      oficinaId: 'of-1',
      prefeituraId: 'pref-1',
    });

    expect(result.data).not.toHaveProperty('passwordHash');
    expect(result.data).not.toHaveProperty('password');
    expect(result.data.id).toBe('fixed-uuid');
    expect(setMock).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'joao@of.com', status: 'ACTIVE' }),
    );
  });
});

describe('UsersService.me', () => {
  it('userId inexistente → NotFoundException', async () => {
    const firebase = makeFirestore({
      userDoc: { exists: false, data: () => null, id: '' },
    });
    const service = new UsersService(firebase);

    await expect(service.me('id-fantasma')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('retorna user sem passwordHash, com credLevel e oficina vinculada', async () => {
    const firebase = makeFirestore({
      userDoc: {
        exists: true,
        id: 'user-1',
        data: () => ({
          id: 'user-1',
          name: 'João',
          email: 'j@of.com',
          passwordHash: 'segredo',
          oficinaId: 'of-1',
          prefeituraId: 'pref-1',
          status: 'ACTIVE',
        }),
      },
      oficinasDoc: {
        exists: true,
        id: 'of-1',
        data: () => ({ nome: 'Mecânica Silva', status: 'Ativa' }),
      },
    });
    const service = new UsersService(firebase);

    const result = await service.me('user-1', 'PARTIAL');

    expect(result.data.user).not.toHaveProperty('passwordHash');
    expect(result.data.user.credLevel).toBe('PARTIAL');
    expect(result.data.oficina).toMatchObject({
      id: 'of-1',
      nome: 'Mecânica Silva',
    });
  });
});
