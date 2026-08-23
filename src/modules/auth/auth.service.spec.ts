jest.mock('bcrypt', () => ({
  hashSync: jest.fn().mockReturnValue('$2b$12$timing_dummy'),
  hash: jest.fn().mockResolvedValue('$2b$12$new_hash'),
  compare: jest.fn(),
}));

jest.mock('../../prisma/prisma.service', () => ({
  PrismaService: class PrismaService {},
}));

import { UnauthorizedException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { AuthService } from './auth.service';
import { FirebaseService } from '../../config/firebase.service';
import { PrismaService } from '../../prisma/prisma.service';
import { hashSenhaOperacional } from '../parceiros/helpers/parceiro-login.helper';

const partnerRow = {
  id: 'partner-uuid',
  legacyId: 'of-1',
  type: 'OFICINA' as const,
  razaoSocial: 'Mecânica Silva LTDA',
  nomeFantasia: 'Mecânica Silva',
  cnpj: '',
  cidadeUf: '',
  endereco: '',
  telefonePrincipal: '',
  emailComercial: '',
  especialidade: '',
  linhasAtuacao: [],
  segmentosAtuacao: [],
  categoriasServico: [],
  status: 'ativo',
  ativo: true,
  companyId: 'company-uuid',
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-01'),
  company: { legacyId: 'pref-1' },
};

const portalUser = {
  id: 'pg-user-uuid',
  legacyId: 'user-1',
  companyId: 'company-uuid',
  partnerId: 'partner-uuid',
  partnerLegacyId: 'of-1',
  nome: 'João',
  usuario: 'joao@of.com',
  email: 'joao@of.com',
  senhaHash: '$2b$12$real_hash',
  perfil: 'gestor',
  vinculo: 'oficina',
  status: 'ativo',
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-01'),
  partner: partnerRow,
};

function makeFirestore(oficinasDoc = { exists: false, data: () => null }) {
  return {
    getFirestore: () => ({
      collection: (name: string) => {
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

function makePrisma(user: typeof portalUser | null = portalUser) {
  return {
    partnerPortalUser: {
      findFirst: jest.fn().mockResolvedValue(user),
      update: jest.fn().mockResolvedValue(user),
    },
    partnerPortalPasswordReset: {
      create: jest.fn(),
      findUnique: jest.fn(),
    },
    $transaction: jest.fn(),
  } as unknown as PrismaService;
}

function makeService(opts?: {
  user?: typeof portalUser | null;
  oficinasDoc?: { exists: boolean; data: () => unknown };
}) {
  const prisma = makePrisma(opts?.user ?? portalUser);
  const firebase = makeFirestore(opts?.oficinasDoc);
  const jwtService = {
    signAsync: jest.fn().mockResolvedValue('jwt_token'),
  } as unknown as JwtService;
  const config = {
    get: jest.fn((key: string) => {
      if (key === 'JWT_SECRET') return 'secret';
      if (key === 'HORAUTIL_WEB_URL') return 'http://localhost:3001';
      return '24h';
    }),
  } as unknown as ConfigService;
  const mail = { enviar: jest.fn().mockResolvedValue({ ok: true }) };
  return {
    service: new AuthService(prisma, firebase, jwtService, config, mail as never),
    prisma,
    mail,
  };
}

beforeEach(() => jest.clearAllMocks());

describe('AuthService.login', () => {
  it('email inexistente → erro genérico (sem vazar existência)', async () => {
    (bcrypt.compare as jest.Mock).mockResolvedValue(false);
    const { service } = makeService({ user: null });

    await expect(
      service.login({ email: 'nao@existe.com', password: '123' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('senha errada → mesmo erro genérico', async () => {
    (bcrypt.compare as jest.Mock).mockResolvedValue(false);
    const { service } = makeService();

    await expect(
      service.login({ email: portalUser.email!, password: 'errada' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('usuário inativo → erro genérico (sem vazar status)', async () => {
    (bcrypt.compare as jest.Mock).mockResolvedValue(true);
    const { service } = makeService({
      user: { ...portalUser, status: 'inativo' },
    });

    const err = await service
      .login({ email: portalUser.email!, password: 'senha' })
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(UnauthorizedException);
    expect((err as UnauthorizedException).message).toBe(
      'Credenciais inválidas.',
    );
  });

  it('credenciais válidas por email → retorna token e user sem senhaHash', async () => {
    (bcrypt.compare as jest.Mock).mockResolvedValue(true);
    const { service } = makeService({
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
      email: portalUser.email!,
      password: 'senha',
    });

    expect(result.token).toBe('jwt_token');
    expect(result.user).not.toHaveProperty('passwordHash');
    expect(result.user).not.toHaveProperty('senhaHash');
    expect(result.user).toMatchObject({
      id: 'user-1',
      email: 'joao@of.com',
      oficinaId: 'of-1',
    });
    expect(result.oficina?.nome).toBe('Mecânica Silva');
  });

  it('credenciais operacionais (SHA256) válidas → retorna token e oficina', async () => {
    const operacional = {
      ...portalUser,
      legacyId: 'doc-operacional',
      nome: 'Gestor Oficina',
      usuario: 'oficina.teste',
      email: null,
      senhaHash: hashSenhaOperacional('senha123'),
    };
    const { service } = makeService({
      user: operacional,
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
      usuario: operacional.usuario,
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
    expect(result.oficina?.nome).toBe('Mecânica Silva');
  });

  it('vinculo desatualizado → corrige pelo tipo do parceiro no login', async () => {
    (bcrypt.compare as jest.Mock).mockResolvedValue(true);
    const stale = {
      ...portalUser,
      vinculo: 'posto',
      partner: { ...partnerRow, type: 'OFICINA' as const },
    };
    const { service, prisma } = makeService({ user: stale });

    const result = await service.login({
      email: stale.email!,
      password: 'senha',
    });

    expect(prisma.partnerPortalUser.update).toHaveBeenCalledWith({
      where: { id: stale.id },
      data: { vinculo: 'oficina' },
    });
    expect(result.user.vinculo).toBe('oficina');
    expect(result.user.oficinaId).toBe('of-1');
    expect(result.user.postoId).toBe('');
  });
});

describe('AuthService.forgotPassword', () => {
  it('envia link de redefinição para usuário oficina', async () => {
    const prisma = makePrisma(portalUser);
    const firebase = makeFirestore();
    const mail = { enviar: jest.fn().mockResolvedValue({ ok: true }) };

    const service = new AuthService(
      prisma,
      firebase,
      { signAsync: jest.fn() } as unknown as JwtService,
      {
        get: jest.fn((key: string) =>
          key === 'HORAUTIL_WEB_URL' ? 'http://localhost:3001' : '24h',
        ),
      } as unknown as ConfigService,
      mail as never,
    );

    await service.forgotPassword({ email: 'oficina@teste.com' });

    expect(prisma.partnerPortalPasswordReset.create).toHaveBeenCalled();
    expect(mail.enviar).toHaveBeenCalledWith(
      expect.objectContaining({
        html: expect.stringContaining('oficina/redefinir-senha?token='),
      }),
    );
  });
});
