import { randomBytes } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { StringValue } from 'ms';
import { FirebaseService } from '../../config/firebase.service';
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

type UsuarioDoc = UsuarioAuth & { id: string };

const RESET_EXPIRA_HORAS = 1;

@Injectable()
export class UserService {
  private readonly logger = new Logger(UserService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly jwtService: JwtService,
    private readonly firebase: FirebaseService,
    private readonly mail: MailService,
    private readonly prisma: PrismaService,
  ) {}

  private get usersCollection() {
    return this.firebase.getFirestore().collection('users');
  }

  private get resetsCollection() {
    return this.firebase.getFirestore().collection('user_password_resets');
  }

  async login(dto: LoginUserDto) {
    const user =
      (await this.tryPostgresLogin(dto)) ??
      (await this.tryFirestoreLogin(dto));

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
    const user = await this.findUserByEmail(email);

    if (user && user.vinculo === 'posto') {
      const token = randomBytes(32).toString('hex');
      const expiresAt = new Date(
        Date.now() + RESET_EXPIRA_HORAS * 60 * 60 * 1000,
      ).toISOString();

      await this.resetsCollection.add({
        token,
        userId: user.id,
        email,
        used: false,
        expiresAt,
        createdAt: new Date().toISOString(),
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
    const snap = await this.resetsCollection
      .where('token', '==', dto.token.trim())
      .limit(1)
      .get();

    if (snap.empty) {
      return { ok: false, message: 'Link inválido ou expirado.' };
    }

    const resetDoc = snap.docs[0];
    const reset = resetDoc.data() as {
      userId: string;
      used?: boolean;
      expiresAt: string;
    };

    if (reset.used) {
      return { ok: false, message: 'Este link já foi utilizado.' };
    }

    if (new Date(reset.expiresAt).getTime() < Date.now()) {
      return { ok: false, message: 'Link expirado. Solicite um novo e-mail.' };
    }

    const userRef = this.usersCollection.doc(reset.userId);
    const userSnap = await userRef.get();
    if (!userSnap.exists) {
      return { ok: false, message: 'Usuário não encontrado.' };
    }

    const senhaHash = this.hashSenha(dto.novaSenha);
    await userRef.update({ senha: senhaHash });
    await resetDoc.ref.update({ used: true, usedAt: new Date().toISOString() });

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

  private async tryPostgresLogin(
    dto: LoginUserDto,
  ): Promise<UsuarioAuth | null> {
    try {
      const senhaHash = hashSenhaPosto(dto.senha);
      const email = dto.email?.trim().toLowerCase();
      const usuario = dto.usuario?.trim();

      const or: Array<{ email?: string; usuario?: string }> = [];
      if (email) or.push({ email });
      if (usuario) or.push({ usuario });
      if (usuario?.includes('@') && !email) {
        or.push({ email: usuario.toLowerCase() });
      }
      if (or.length === 0) return null;

      const rows = await this.prisma.partnerPortalUser.findMany({
        where: {
          vinculo: 'posto',
          status: 'ativo',
          OR: or,
        },
        include: { company: { select: { legacyId: true } } },
        take: 10,
      });

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
    } catch {
      return null;
    }
  }

  private async tryFirestoreLogin(
    dto: LoginUserDto,
  ): Promise<UsuarioAuth | null> {
    try {
      const senhaHash = this.hashSenha(dto.senha);
      const email = dto.email?.trim().toLowerCase();
      const usuario = dto.usuario?.trim();

      const candidatos: UsuarioDoc[] = [];

      if (email) {
        candidatos.push(...(await this.findUsersByEmail(email)));
      }

      if (usuario) {
        const porUsuario = await this.findUsersByUsuario(usuario);
        for (const u of porUsuario) {
          if (!candidatos.some((c) => c.id === u.id)) {
            candidatos.push(u);
          }
        }
        if (usuario.includes('@') && !email) {
          const porEmail = await this.findUsersByEmail(usuario.toLowerCase());
          for (const u of porEmail) {
            if (!candidatos.some((c) => c.id === u.id)) {
              candidatos.push(u);
            }
          }
        }
      }

      for (const user of candidatos) {
        if (user.senha === senhaHash) {
          const { id: _id, ...auth } = user;
          return auth;
        }
      }

      return null;
    } catch {
      return null;
    }
  }

  private async findUserByEmail(email: string): Promise<UsuarioDoc | null> {
    const users = await this.findUsersByEmail(email);
    return users[0] ?? null;
  }

  private async findUsersByEmail(email: string): Promise<UsuarioDoc[]> {
    const snap = await this.usersCollection
      .where('email', '==', email)
      .limit(5)
      .get();
    return snap.docs.map((d) => this.docToUsuario(d.id, d.data()));
  }

  private async findUsersByUsuario(usuario: string): Promise<UsuarioDoc[]> {
    const snap = await this.usersCollection
      .where('usuario', '==', usuario)
      .limit(5)
      .get();
    return snap.docs.map((d) => this.docToUsuario(d.id, d.data()));
  }

  private docToUsuario(id: string, data: Record<string, unknown>): UsuarioDoc {
    return {
      id,
      nome: this.toSafeString(data.nome),
      usuario: this.toSafeString(data.usuario),
      email: this.toSafeString(data.email) || undefined,
      senha: this.toSafeString(data.senha),
      perfil: this.toSafeString(data.perfil) || 'gestor',
      vinculo:
        this.toSafeString(data.vinculo) ||
        this.toSafeString(data.type) ||
        'prefeitura',
      prefeituraId: this.toSafeString(data.prefeituraId) || 'tl-ms',
      ...(this.toSafeString(data.postoId)
        ? { postoId: this.toSafeString(data.postoId) }
        : {}),
    };
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

  private hashSenha(value: string): string {
    return hashSenhaPosto(value);
  }

  private toSafeString(value: unknown): string {
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'boolean') {
      return String(value);
    }
    return '';
  }
}
