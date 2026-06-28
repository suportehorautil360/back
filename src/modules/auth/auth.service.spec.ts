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
import { hashSenhaOperacional } from '../parceiros/helpers/parceiro-login.helper';

function makeFirestore({
  usersSnap = { empty: true, docs: [] as { id: string; data: () => unknown }[] },
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
    get: jest.fn((key: string) => {
      if (key === 'JWT_SECRET') return 'secret';
      if (key === 'OFICINA_WEB_URL') return 'http://localhost:3001';
      return '24h';
    }),
  } as unknown as ConfigService;
  const mail = { enviar: jest.fn().mockResolvedValue({ ok: true }) };
  return new AuthService(firebase, jwtService, config, mail as never);
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

const operacionalUser = {
  id: 'uuid-payload',
  nome: 'Gestor Oficina',
  usuario: 'oficina.teste',
  senha: hashSenhaOperacional('senha123'),
  vinculo: 'oficina',
  officinaId: 'of-1',
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

    expect(bcrypt.compare).toHaveBeenCalledTimes(1);
  });

  it('senha errada → mesmo erro genérico', async () => {
    (bcrypt.compare as jest.Mock).mockResolvedValue(false);
    const service = makeService({
      usersSnap: {
        empty: false,
        docs: [{ id: 'user-1', data: () => activeUser }],
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
        docs: [{ id: 'user-1', data: () => ({ ...activeUser, status: 'INACTIVE' }) }],
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

  it('credenciais válidas por email → retorna token e user sem passwordHash', async () => {
    (bcrypt.compare as jest.Mock).mockResolvedValue(true);
    const service = makeService({
      usersSnap: {
        empty: false,
        docs: [{ id: 'user-1', data: () => activeUser }],
      },
      oficinasDoc: {
        exists: true,
        data: () => ({
          nomeFantasia: 'Mecânica Silva',
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
    expect(result.oficina?.nome).toBe('Mecânica Silva');
  });

  it('credenciais operacionais válidas → retorna token e oficina', async () => {
    const service = makeService({
      usersSnap: {
        empty: false,
        docs: [{ id: 'doc-operacional', data: () => operacionalUser }],
      },
      oficinasDoc: {
        exists: true,
        data: () => ({
          nomeFantasia: 'Auto Center',
          status: 'Ativa',
          prefeituraId: 'pref-1',
        }),
      },
    });

    const result = await service.login({
      usuario: operacionalUser.usuario,
      password: 'senha123',
    });

    expect(result.token).toBe('jwt_token');
    expect(result.user).toMatchObject({
      id: 'doc-operacional',
      name: 'Gestor Oficina',
      usuario: 'oficina.teste',
      oficinaId: 'of-1',
      prefeituraId: 'pref-1',
    });
    expect(result.oficina?.nome).toBe('Auto Center');
  });
});

describe('AuthService.forgotPassword', () => {
  function makeForgotPasswordService(userDoc?: {
    id: string;
    data: Record<string, unknown>;
  }) {
    const addReset = jest.fn().mockResolvedValue(undefined);
    const mail = { enviar: jest.fn().mockResolvedValue({ ok: true }) };
    const firebase = {
      getFirestore: () => ({
        collection: (name: string) => {
          if (name === 'user_password_resets') {
            return { add: addReset };
          }
          return {
            where: jest.fn(() => ({
              limit: jest.fn(() => ({
                get: jest.fn().mockResolvedValue({
                  empty: !userDoc,
                  docs: userDoc
                    ? [{ id: userDoc.id, data: () => userDoc.data }]
                    : [],
                }),
              })),
            })),
          };
        },
      }),
    } as unknown as FirebaseService;

    const service = new AuthService(
      firebase,
      { signAsync: jest.fn() } as unknown as JwtService,
      {
        get: jest.fn((key: string) =>
          key === 'OFICINA_WEB_URL' ? 'http://localhost:3001' : '24h',
        ),
      } as unknown as ConfigService,
      mail as never,
    );

    return { service, addReset, mail };
  }

  it('envia link de redefinição para usuário oficina', async () => {
    const { service, addReset, mail } = makeForgotPasswordService({
      id: 'of-user',
      data: {
        nome: 'Oficina',
        vinculo: 'oficina',
        officinaId: 'of-1',
      },
    });

    await service.forgotPassword({ email: 'oficina@teste.com' });

    expect(addReset).toHaveBeenCalled();
    expect(mail.enviar).toHaveBeenCalledWith(
      expect.objectContaining({
        html: expect.stringContaining('redefinir-senha?token='),
      }),
    );
  });
});
