jest.mock('bcrypt', () => ({
  hashSync: jest.fn().mockReturnValue('$2b$12$timing_dummy'),
  compare: jest.fn(),
}));

import { UnauthorizedException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { AuthService } from './auth.service';
import { FirebaseService } from '../../config/firebase.service';

function makeFirestore({
  usersSnap = { empty: true, docs: [] as { data: () => unknown }[] },
  oficinasDoc = { exists: false, data: () => null },
} = {}) {
  return {
    getFirestore: () => ({
      collection: (name: string) => {
        if (name === 'users') {
          return {
            where: jest.fn(() => ({
              limit: jest.fn(() => ({
                get: jest.fn().mockResolvedValue(usersSnap),
              })),
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

function makeService(opts?: Parameters<typeof makeFirestore>[0]) {
  const firebase = makeFirestore(opts);
  const jwtService = {
    signAsync: jest.fn().mockResolvedValue('jwt_token'),
  } as unknown as JwtService;
  const config = {
    get: jest.fn((key: string) => (key === 'JWT_SECRET' ? 'secret' : '24h')),
  } as unknown as ConfigService;
  return new AuthService(firebase, jwtService, config);
}

const activeUser = {
  id: 'user-1',
  name: 'João',
  email: 'joao@of.com',
  passwordHash: '$2b$12$real_hash',
  status: 'ACTIVE',
  oficinaId: 'of-1',
  prefeituraId: 'pref-1',
};

beforeEach(() => jest.clearAllMocks());

describe('AuthService.login', () => {
  it('email inexistente → erro genérico (sem vazar existência)', async () => {
    (bcrypt.compare as jest.Mock).mockResolvedValue(false);
    const service = makeService({ usersSnap: { empty: true, docs: [] } });

    await expect(
      service.login({ email: 'nao@existe.com', password: '123' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    // bcrypt.compare deve ser chamado mesmo sem usuário (proteção de timing)
    expect(bcrypt.compare).toHaveBeenCalledTimes(1);
  });

  it('senha errada → mesmo erro genérico', async () => {
    (bcrypt.compare as jest.Mock).mockResolvedValue(false);
    const service = makeService({
      usersSnap: {
        empty: false,
        docs: [{ data: () => activeUser }],
      },
    });

    await expect(
      service.login({ email: activeUser.email, password: 'errada' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('usuário INACTIVE → erro genérico (sem vazar status)', async () => {
    (bcrypt.compare as jest.Mock).mockResolvedValue(true);
    const service = makeService({
      usersSnap: {
        empty: false,
        docs: [{ data: () => ({ ...activeUser, status: 'INACTIVE' }) }],
      },
    });

    const err = await service
      .login({ email: activeUser.email, password: 'senha' })
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(UnauthorizedException);
    expect((err as UnauthorizedException).message).toBe(
      'Credenciais inválidas.',
    );
  });

  it('credenciais válidas → retorna token e user sem passwordHash', async () => {
    (bcrypt.compare as jest.Mock).mockResolvedValue(true);
    const service = makeService({
      usersSnap: {
        empty: false,
        docs: [{ data: () => activeUser }],
      },
      oficinasDoc: {
        exists: true,
        data: () => ({
          credChecklist: {
            fisc_cndt: true,
            fisc_estadual: false,
            fisc_federal: false,
            fisc_fgts: false,
            fisc_municipal: false,
            hab_balanco: false,
            hab_falencia: false,
            id_cnpj: false,
            id_contrato: false,
            id_endereco: false,
            id_socios: false,
            tec_alvara: false,
            tec_ambiental: false,
            tec_atestado: false,
            tec_avcb: false,
          },
        }),
      },
    });

    const result = await service.login({
      email: activeUser.email,
      password: 'senha',
    });

    expect(result.token).toBe('jwt_token');
    expect(result.user).not.toHaveProperty('passwordHash');
    expect(result.user).toMatchObject({
      id: 'user-1',
      email: 'joao@of.com',
      oficinaId: 'of-1',
    });
  });
});
