import { randomBytes } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { StringValue } from 'ms';
import { hashSenhaPosto } from '../../common/prisma/operator-auth.helper';
import { PrismaService } from '../../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { BoasVindasPostoDto } from './dto/boas-vindas-posto.dto';
import { EsqueciSenhaDto } from './dto/esqueci-senha.dto';
import { LoginUserDto } from './dto/login-user.dto';
import { RedefinirSenhaDto } from './dto/redefinir-senha.dto';
import {
  htmlBoasVindasPosto,
  htmlResetSenhaPosto,
} from './helpers/user-mail.helper';

type UsuarioAuth = {
  nome: string;
  usuario: string;
  email?: string;
  senha: string;
  perfil: string;
  vinculo: string;
  prefeituraId: string;
  postoId?: string;
};

const RESET_EXPIRA_HORAS = 1;

@Injectable()
export class UserService {
  private readonly logger = new Logger(UserService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly jwtService: JwtService,
    private readonly mail: MailService,
    private readonly prisma: PrismaService,
  ) {}

  async login(dto: LoginUserDto) {
    const candidates = await this.findPortalUsers(dto);
    const user = this.matchPassword(candidates, dto.senha);

    if (!user) {
      return {
        ok: false,
        msg: 'Login ou senha invalidos.',
      };
    }

    const expiresIn = this.configService.get<string>('JWT_EXPIRES_IN') ?? '24h';

    const accessToken = await this.jwtService.signAsync(
      {
        sub: user.usuario,
        perfil: user.perfil,
        vinculo: user.vinculo,
        prefeituraId: user.prefeituraId,
        postoId: user.postoId ?? null,
      },
      {
        secret: this.getJwtSecret(),
        expiresIn: expiresIn as StringValue,
      },
    );

    const { senha: _s, ...userSafe } = user;

    return {
      ok: true,
      user: userSafe,
      accessToken,
      tokenType: 'Bearer',
      expiresIn,
      message: 'Login realizado com sucesso.',
    };
  }

  /** Sempre responde ok (não revela se o e-mail existe). */
  async esqueciSenha(dto: EsqueciSenhaDto) {
    const email = dto.email.trim().toLowerCase();
    const user = await this.prisma.partnerPortalUser.findFirst({
      where: { email, vinculo: 'posto', status: 'ativo' },
    });

    if (user) {
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

      const link = `${this.postoWebUrl()}/redefinir-senha?token=${encodeURIComponent(token)}`;
      const { html, text } = htmlResetSenhaPosto({
        nome: user.nome,
        link,
        expiraHoras: RESET_EXPIRA_HORAS,
      });

      const envio = await this.mail.enviar({
        to: email,
        subject: 'Redefinir senha — Portal do Posto',
        html,
        text,
      });

      if (!envio.ok) {
        this.logger.warn(
          `Falha ao enviar e-mail de reset para ${email}: ${envio.erro}`,
        );
      }
    }

    return {
      ok: true,
      message:
        'Se o e-mail estiver cadastrado, você receberá instruções em instantes.',
    };
  }

  async redefinirSenha(dto: RedefinirSenhaDto) {
    const reset = await this.prisma.partnerPortalPasswordReset.findUnique({
      where: { token: dto.token.trim() },
    });

    if (!reset) {
      return { ok: false, message: 'Link inválido ou expirado.' };
    }

    if (reset.used) {
      return { ok: false, message: 'Este link já foi utilizado.' };
    }

    if (reset.expiresAt.getTime() < Date.now()) {
      return { ok: false, message: 'Link expirado. Solicite um novo e-mail.' };
    }

    const senhaHash = hashSenhaPosto(dto.novaSenha);

    await this.prisma.$transaction([
      this.prisma.partnerPortalUser.update({
        where: { id: reset.userId },
        data: { senhaHash },
      }),
      this.prisma.partnerPortalPasswordReset.update({
        where: { id: reset.id },
        data: { used: true, usedAt: new Date() },
      }),
    ]);

    return { ok: true, message: 'Senha redefinida com sucesso.' };
  }

  async enviarBoasVindasPosto(dto: BoasVindasPostoDto) {
    const loginUrl = this.postoWebUrl();
    const { html, text } = htmlBoasVindasPosto({
      nome: dto.nome.trim(),
      usuario: dto.usuario.trim(),
      postoNome: dto.postoNome?.trim(),
      senhaTemporaria: dto.senhaTemporaria,
      loginUrl,
    });

    const envio = await this.mail.enviar({
      to: dto.email.trim().toLowerCase(),
      subject: 'Seu acesso ao portal do posto — Hora Útil 360',
      html,
      text,
    });

    if (!envio.ok) {
      return {
        ok: false,
        message: envio.erro ?? 'Não foi possível enviar o e-mail.',
      };
    }

    return { ok: true, message: 'E-mail de boas-vindas enviado.' };
  }

  private async findPortalUsers(dto: LoginUserDto) {
    const email = dto.email?.trim().toLowerCase();
    const usuario = dto.usuario?.trim();

    const or: Array<{ email?: string; usuario?: string }> = [];
    if (email) or.push({ email });
    if (usuario) or.push({ usuario });
    if (usuario?.includes('@') && !email) {
      or.push({ email: usuario.toLowerCase() });
    }
    if (or.length === 0) return [];

    return this.prisma.partnerPortalUser.findMany({
      where: {
        vinculo: 'posto',
        status: 'ativo',
        OR: or,
      },
      include: { company: { select: { legacyId: true } } },
      take: 10,
    });
  }

  private matchPassword(
    rows: Awaited<ReturnType<UserService['findPortalUsers']>>,
    senha: string,
  ): UsuarioAuth | null {
    const senhaHash = hashSenhaPosto(senha);
    for (const row of rows) {
      if (row.senhaHash !== senhaHash) continue;
      return {
        nome: row.nome,
        usuario: row.usuario,
        email: row.email ?? undefined,
        senha: row.senhaHash,
        perfil: row.perfil,
        vinculo: 'posto',
        prefeituraId: row.company.legacyId ?? '',
        postoId: row.partnerLegacyId ?? undefined,
      };
    }
    return null;
  }

  private postoWebUrl(): string {
    const raw =
      this.configService.get<string>('POSTO_WEB_URL') ??
      'http://localhost:3004';
    return raw.replace(/\/$/, '');
  }

  private getJwtSecret(): string {
    const jwtSecret = this.configService.get<string>('JWT_SECRET') ?? '';
    if (!jwtSecret) {
      throw new Error('JWT_SECRET nao configurado no ambiente.');
    }
    return jwtSecret;
  }
}
