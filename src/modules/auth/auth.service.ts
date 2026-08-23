import { randomBytes } from 'node:crypto';
import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { StringValue } from 'ms';
import { FirebaseService } from '../../config/firebase.service';
import { PrismaService } from '../../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import {
  computeCredLevel,
  type CredChecklist,
} from './domain/cred-checklist.policy';
import { LoginDto } from './dto/login.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { htmlResetSenhaOficina } from './helpers/auth-mail.helper';
import {
  hashPortalPassword,
  isPortalUserActive,
  verifyPortalPassword,
} from './helpers/partner-portal-password.helper';
import {
  mapPortalUserToOficina,
  portalPartnerLegacyId,
  portalPrefeituraLegacyId,
  portalUserPublicId,
  resolvePortalVinculo,
  type PortalUserWithPartner,
} from './helpers/partner-portal-user.helper';
import { assertNewPasswordStrength } from './helpers/user-password.helper';

const INVALID_CREDENTIALS = 'Credenciais inválidas.';
const FORGOT_PASSWORD_MESSAGE =
  'Se o e-mail estiver cadastrado, você receberá um link para redefinir a senha em instantes.';
const RESET_EXPIRA_HORAS = 1;

const portalUserInclude = {
  partner: {
    include: {
      company: { select: { legacyId: true } },
    },
  },
} as const;

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly firebase: FirebaseService,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
    private readonly mail: MailService,
  ) {}

  async login(dto: LoginDto) {
    const email = dto.email?.trim().toLowerCase();
    const usuario = dto.usuario?.trim();

    if (!email && !usuario) {
      throw new BadRequestException('Informe email ou usuário.');
    }

    const user = email
      ? await this.findPortalUserByEmail(email)
      : await this.findPortalUserByUsuario(usuario!);

    if (!user || !(await verifyPortalPassword(dto.password, user.senhaHash))) {
      throw new UnauthorizedException(INVALID_CREDENTIALS);
    }

    if (!isPortalUserActive(user.status)) {
      throw new UnauthorizedException(INVALID_CREDENTIALS);
    }

    const vinculo = resolvePortalVinculo(user);
    if (vinculo !== user.vinculo) {
      await this.prisma.partnerPortalUser.update({
        where: { id: user.id },
        data: { vinculo },
      });
    }

    const partnerLegacyId = portalPartnerLegacyId(user);
    const credLevel = await this.resolveCredLevel(partnerLegacyId, vinculo);

    const secret = this.config.get<string>('JWT_SECRET');
    if (!secret) {
      throw new InternalServerErrorException('JWT_SECRET não configurado.');
    }

    const expiresIn = this.config.get<string>('JWT_EXPIRES_IN') ?? '24h';
    const prefeituraId = portalPrefeituraLegacyId(user);
    const publicId = portalUserPublicId(user);

    const token = await this.jwtService.signAsync(
      {
        sub: publicId,
        oficinaId: vinculo === 'oficina' ? partnerLegacyId : '',
        postoId: vinculo === 'posto' ? partnerLegacyId : '',
        prefeituraId,
        perfil: user.perfil || 'gestor',
        vinculo,
        credLevel,
      },
      { secret, expiresIn: expiresIn as StringValue },
    );

    const oficina = mapPortalUserToOficina(user);

    return {
      token,
      user: {
        id: publicId,
        name: user.nome,
        email: user.email ?? '',
        usuario: user.usuario,
        oficinaId: vinculo === 'oficina' ? partnerLegacyId : '',
        postoId: vinculo === 'posto' ? partnerLegacyId : '',
        prefeituraId,
        mustChangePassword: false,
        vinculo,
      },
      ...(oficina ? { oficina } : {}),
    };
  }

  async changePassword(userId: string, dto: ChangePasswordDto) {
    const user = await this.findPortalUserByPublicId(userId);
    if (!user) {
      throw new NotFoundException('Usuário não encontrado.');
    }

    const currentValid = await verifyPortalPassword(
      dto.currentPassword,
      user.senhaHash,
    );
    if (!currentValid) {
      throw new UnauthorizedException('Senha atual incorreta.');
    }

    assertNewPasswordStrength(dto.newPassword);

    await this.prisma.partnerPortalUser.update({
      where: { id: user.id },
      data: {
        senhaHash: await hashPortalPassword(dto.newPassword),
      },
    });

    return { message: 'Senha alterada com sucesso.' };
  }

  /** Não revela se o e-mail existe. */
  async forgotPassword(dto: ForgotPasswordDto) {
    const email = dto.email.trim().toLowerCase();
    const user = await this.findPortalUserByEmail(email);

    if (user?.email) {
      const token = randomBytes(32).toString('hex');
      const expiresAt = new Date(
        Date.now() + RESET_EXPIRA_HORAS * 60 * 60 * 1000,
      );

      await this.prisma.partnerPortalPasswordReset.create({
        data: {
          userId: user.id,
          email,
          token,
          expiresAt,
        },
      });

      const link = `${this.portalWebUrl()}/oficina/redefinir-senha?token=${encodeURIComponent(token)}`;
      const { html, text } = htmlResetSenhaOficina({
        nome: user.nome || 'Operador',
        link,
        expiraHoras: RESET_EXPIRA_HORAS,
      });

      const envio = await this.mail.enviar({
        to: email,
        subject: 'Redefinir senha — Portal parceiro',
        html,
        text,
      });

      if (!envio.ok) {
        this.logger.warn(
          `Falha ao enviar e-mail de esqueci senha para ${email}: ${envio.erro}`,
        );
      }
    }

    return { message: FORGOT_PASSWORD_MESSAGE };
  }

  async resetPassword(dto: ResetPasswordDto) {
    const reset = await this.prisma.partnerPortalPasswordReset.findUnique({
      where: { token: dto.token.trim() },
      include: { user: true },
    });

    if (!reset) {
      throw new BadRequestException('Link inválido ou expirado.');
    }

    if (reset.used) {
      throw new BadRequestException('Este link já foi utilizado.');
    }

    if (reset.expiresAt.getTime() < Date.now()) {
      throw new BadRequestException('Link expirado. Solicite um novo e-mail.');
    }

    assertNewPasswordStrength(dto.newPassword);

    await this.prisma.$transaction([
      this.prisma.partnerPortalUser.update({
        where: { id: reset.userId },
        data: {
          senhaHash: await hashPortalPassword(dto.newPassword),
        },
      }),
      this.prisma.partnerPortalPasswordReset.update({
        where: { id: reset.id },
        data: { used: true, usedAt: new Date() },
      }),
    ]);

    return { message: 'Senha redefinida com sucesso.' };
  }

  private portalWebUrl(): string {
    const raw =
      this.config.get<string>('HORAUTIL_WEB_URL') ??
      this.config.get<string>('OFICINA_WEB_URL') ??
      this.config.get<string>('POSTO_WEB_URL') ??
      'http://localhost:3001';
    return raw.replace(/\/$/, '');
  }

  private async findPortalUserByEmail(
    email: string,
  ): Promise<PortalUserWithPartner | null> {
    return this.prisma.partnerPortalUser.findFirst({
      where: {
        OR: [{ email: { equals: email, mode: 'insensitive' } }, { usuario: email }],
        vinculo: { in: ['oficina', 'posto'] },
      },
      include: portalUserInclude,
    });
  }

  private async findPortalUserByUsuario(
    usuario: string,
  ): Promise<PortalUserWithPartner | null> {
    return this.prisma.partnerPortalUser.findFirst({
      where: {
        usuario,
        vinculo: { in: ['oficina', 'posto'] },
      },
      include: portalUserInclude,
    });
  }

  private async findPortalUserByPublicId(
    userId: string,
  ): Promise<PortalUserWithPartner | null> {
    const id = userId.trim();
    if (!id) return null;

    return this.prisma.partnerPortalUser.findFirst({
      where: {
        OR: [{ id }, { legacyId: id }],
      },
      include: portalUserInclude,
    });
  }

  private async resolveCredLevel(
    partnerLegacyId: string,
    vinculo: string,
  ): Promise<'FULL' | 'PARTIAL' | 'PENDING'> {
    if (vinculo !== 'oficina' || !partnerLegacyId) {
      return 'PENDING';
    }

    const oficinasDoc = await this.firebase
      .getFirestore()
      .collection('oficinas')
      .doc(partnerLegacyId)
      .get();

    const credChecklist = oficinasDoc.exists
      ? (oficinasDoc.data()?.credChecklist as CredChecklist | null)
      : null;

    return credChecklist ? computeCredLevel(credChecklist) : 'PENDING';
  }
}
