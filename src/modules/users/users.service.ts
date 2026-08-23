import {
  ConflictException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { randomUUID } from 'node:crypto';
import { mapPartnerToOficinaListItem } from '../../common/prisma/partner-prisma.mapper';
import { PrismaService } from '../../prisma/prisma.service';
import {
  portalPartnerLegacyId,
  portalPrefeituraLegacyId,
  portalUserPublicId,
} from '../auth/helpers/partner-portal-user.helper';
import { BCRYPT_ROUNDS } from '../auth/helpers/partner-portal-password.helper';
import { CreateUserDto } from './dto/create-user.dto';

const portalUserInclude = {
  partner: {
    include: {
      company: { select: { legacyId: true } },
    },
  },
} as const;

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async registerUser(dto: CreateUserDto) {
    try {
      const email = dto.email.trim().toLowerCase();
      const existing = await this.prisma.partnerPortalUser.findFirst({
        where: {
          OR: [{ email }, { usuario: email }],
        },
        select: { id: true },
      });

      if (existing) {
        throw new ConflictException('Email já cadastrado.');
      }

      const company = await this.prisma.company.findFirst({
        where: { legacyId: dto.prefeituraId },
        select: { id: true },
      });
      if (!company) {
        throw new ConflictException('Cliente (prefeituraId) não encontrado.');
      }

      const partner = await this.prisma.partner.findFirst({
        where: {
          type: 'OFICINA',
          OR: [{ legacyId: dto.oficinaId }, { id: dto.oficinaId }],
          companyId: company.id,
        },
        select: { id: true, legacyId: true },
      });
      if (!partner) {
        throw new ConflictException('Oficina não encontrada.');
      }

      const id = randomUUID();
      const passwordHash = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);

      await this.prisma.partnerPortalUser.create({
        data: {
          legacyId: id,
          companyId: company.id,
          partnerId: partner.id,
          partnerLegacyId: partner.legacyId ?? dto.oficinaId,
          nome: dto.name,
          usuario: email,
          email,
          senhaHash: passwordHash,
          perfil: 'gestor',
          vinculo: 'oficina',
          status: 'ativo',
        },
      });

      return {
        data: {
          id,
          name: dto.name,
          email,
          oficinaId: partner.legacyId ?? dto.oficinaId,
          prefeituraId: dto.prefeituraId,
          status: 'ativo',
        },
        message: 'Usuário criado com sucesso.',
      };
    } catch (error) {
      if (error instanceof ConflictException) throw error;
      console.error('Erro ao criar usuário:', error);
      throw new InternalServerErrorException(
        'Não foi possível criar o usuário.',
      );
    }
  }

  async me(userId: string, credLevel?: string) {
    try {
      const row = await this.prisma.partnerPortalUser.findFirst({
        where: {
          OR: [{ id: userId }, { legacyId: userId }],
        },
        include: portalUserInclude,
      });

      if (!row) {
        throw new NotFoundException('Usuário não encontrado.');
      }

      const partnerLegacyId = portalPartnerLegacyId(row);
      const prefeituraId = portalPrefeituraLegacyId(row);

      const user = {
        id: portalUserPublicId(row),
        name: row.nome,
        email: row.email ?? '',
        usuario: row.usuario,
        oficinaId: row.vinculo === 'oficina' ? partnerLegacyId : '',
        postoId: row.vinculo === 'posto' ? partnerLegacyId : '',
        prefeituraId,
        status: row.status,
        mustChangePassword: false,
        credLevel,
      };

      const oficina =
        row.partner && row.vinculo === 'oficina'
          ? mapPartnerToOficinaListItem(row.partner, prefeituraId)
          : null;

      return {
        data: { user, oficina },
        message: 'OK',
      };
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      console.error('Erro ao buscar usuário:', error);
      throw new InternalServerErrorException(
        'Não foi possível buscar o usuário.',
      );
    }
  }
}
