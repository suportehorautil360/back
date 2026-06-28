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
import * as bcrypt from 'bcrypt';
import * as admin from 'firebase-admin';
import type { StringValue } from 'ms';
import type {
  QueryDocumentSnapshot,
} from 'firebase-admin/firestore';
import { FirebaseService } from '../../config/firebase.service';
import { MailService } from '../mail/mail.service';
import { mapOficinaListItem } from '../oficinas/helpers/oficinas-list.helper';
import { hashSenhaOperacional } from '../parceiros/helpers/parceiro-login.helper';
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
  assertNewPasswordStrength,
  resolveMustChangePassword,
  usesBcryptPassword,
} from './helpers/user-password.helper';

const BCRYPT_ROUNDS = 12;
const TIMING_DUMMY_HASH = bcrypt.hashSync('_timing_', BCRYPT_ROUNDS);

const INVALID_CREDENTIALS = 'Credenciais inválidas.';
const FORGOT_PASSWORD_MESSAGE =
  'Se o e-mail estiver cadastrado, você receberá um link para redefinir a senha em instantes.';
const RESET_EXPIRA_HORAS = 1;

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly firebase: FirebaseService,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
    private readonly mail: MailService,
  ) {}

  async login(dto: LoginDto) {
    const email = dto.email?.trim();
    const usuario = dto.usuario?.trim();

    if (!email && !usuario) {
      throw new BadRequestException('Informe email ou usuário.');
    }

    const doc = email
      ? await this.findUserByEmail(email)
      : await this.findUserByUsuario(usuario!);

    const userData = doc?.data();

    const match = email
      ? await this.matchesEmailPassword(dto.password, userData)
      : this.matchesOperacionalPassword(dto.password, userData);

    if (!doc || !match) {
      throw new UnauthorizedException(INVALID_CREDENTIALS);
    }

    if (!this.isUserActive(userData)) {
      throw new UnauthorizedException(INVALID_CREDENTIALS);
    }

    const oficinaId = this.resolveOficinaId(userData);

    const oficinasDoc = oficinaId
      ? await this.firebase
          .getFirestore()
          .collection('oficinas')
          .doc(oficinaId)
          .get()
      : null;

    const credChecklist = oficinasDoc?.exists
      ? (oficinasDoc.data()?.credChecklist as CredChecklist | null)
      : null;

    const credLevel = credChecklist
      ? computeCredLevel(credChecklist)
      : 'PENDING';

    const secret = this.config.get<string>('JWT_SECRET');
    if (!secret) {
      throw new InternalServerErrorException('JWT_SECRET não configurado.');
    }

    const expiresIn = this.config.get<string>('JWT_EXPIRES_IN') ?? '24h';

    const toStr = (v: unknown) =>
      typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '';

    const token = await this.jwtService.signAsync(
      {
        sub: doc.id,
        oficinaId,
        prefeituraId: toStr(userData?.prefeituraId),
        credLevel,
      },
      { secret, expiresIn: expiresIn as StringValue },
    );

    const oficina =
      oficinasDoc?.exists && oficinaId
        ? mapOficinaListItem(oficinaId, oficinasDoc.data() ?? {})
        : null;

    return {
      token,
      user: {
        id: doc.id,
        name: toStr(userData?.name) || toStr(userData?.nome),
        email: toStr(userData?.email),
        usuario: toStr(userData?.usuario),
        oficinaId,
        prefeituraId: toStr(userData?.prefeituraId),
        mustChangePassword: resolveMustChangePassword(userData),
      },
      ...(oficina ? { oficina } : {}),
    };
  }

  async changePassword(userId: string, dto: ChangePasswordDto) {
    const userRef = this.firebase.getFirestore().collection('users').doc(userId);
    const userDoc = await userRef.get();

    if (!userDoc.exists) {
      throw new NotFoundException('Usuário não encontrado.');
    }

    const userData = userDoc.data();
    const currentValid = usesBcryptPassword(userData)
      ? await bcrypt.compare(dto.currentPassword, userData!.passwordHash as string)
      : this.matchesOperacionalPassword(dto.currentPassword, userData);

    if (!currentValid) {
      throw new UnauthorizedException('Senha atual incorreta.');
    }

    assertNewPasswordStrength(dto.newPassword);

    const update: Record<string, unknown> = {
      mustChangePassword: false,
      firstLogin: false,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    if (usesBcryptPassword(userData)) {
      update.passwordHash = await bcrypt.hash(dto.newPassword, BCRYPT_ROUNDS);
    } else {
      update.senha = hashSenhaOperacional(dto.newPassword);
    }

    await userRef.update(update);

    return { message: 'Senha alterada com sucesso.' };
  }

  /** Não revela se o e-mail existe. */
  async forgotPassword(dto: ForgotPasswordDto) {
    const email = dto.email.trim().toLowerCase();
    const userDoc = await this.findOficinaUserByEmail(email);

    if (userDoc) {
      const userData = userDoc.data() ?? {};
      const token = randomBytes(32).toString('hex');
      const expiresAt = new Date(
        Date.now() + RESET_EXPIRA_HORAS * 60 * 60 * 1000,
      ).toISOString();

      await this.resetsCollection.add({
        token,
        userId: userDoc.id,
        email,
        scope: 'oficina',
        used: false,
        expiresAt,
        createdAt: new Date().toISOString(),
      });

      const toStr = (v: unknown) =>
        typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '';
      const nome = toStr(userData.nome) || toStr(userData.name) || 'Operador';
      const link = `${this.oficinaWebUrl()}/redefinir-senha?token=${encodeURIComponent(token)}`;
      const { html, text } = htmlResetSenhaOficina({
        nome,
        link,
        expiraHoras: RESET_EXPIRA_HORAS,
      });

      const envio = await this.mail.enviar({
        to: email,
        subject: 'Redefinir senha — App da Oficina',
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
    const snap = await this.resetsCollection
      .where('token', '==', dto.token.trim())
      .limit(1)
      .get();

    if (snap.empty) {
      throw new BadRequestException('Link inválido ou expirado.');
    }

    const resetDoc = snap.docs[0];
    const reset = resetDoc.data() as {
      userId: string;
      used?: boolean;
      expiresAt: string;
      scope?: string;
    };

    if (reset.used) {
      throw new BadRequestException('Este link já foi utilizado.');
    }

    if (new Date(reset.expiresAt).getTime() < Date.now()) {
      throw new BadRequestException('Link expirado. Solicite um novo e-mail.');
    }

    const userRef = this.usersCollection.doc(reset.userId);
    const userSnap = await userRef.get();
    if (!userSnap.exists) {
      throw new NotFoundException('Usuário não encontrado.');
    }

    const userData = userSnap.data();
    assertNewPasswordStrength(dto.newPassword);

    const update: Record<string, unknown> = {
      mustChangePassword: false,
      firstLogin: false,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    if (usesBcryptPassword(userData)) {
      update.passwordHash = await bcrypt.hash(dto.newPassword, BCRYPT_ROUNDS);
    } else {
      update.senha = hashSenhaOperacional(dto.newPassword);
    }

    await userRef.update(update);
    await resetDoc.ref.update({ used: true, usedAt: new Date().toISOString() });

    return { message: 'Senha redefinida com sucesso.' };
  }

  private get usersCollection() {
    return this.firebase.getFirestore().collection('users');
  }

  private get resetsCollection() {
    return this.firebase.getFirestore().collection('user_password_resets');
  }

  private async findOficinaUserByEmail(
    email: string,
  ): Promise<QueryDocumentSnapshot | null> {
    const candidates = new Map<string, QueryDocumentSnapshot>();

    const byEmail = await this.usersCollection
      .where('email', '==', email)
      .limit(5)
      .get();
    for (const doc of byEmail.docs) {
      candidates.set(doc.id, doc);
    }

    const byUsuario = await this.usersCollection
      .where('usuario', '==', email)
      .limit(5)
      .get();
    for (const doc of byUsuario.docs) {
      candidates.set(doc.id, doc);
    }

    for (const doc of candidates.values()) {
      if (this.isOficinaUser(doc.data())) {
        return doc;
      }
    }

    return null;
  }

  private isOficinaUser(
    userData: FirebaseFirestore.DocumentData | undefined,
  ): boolean {
    if (!userData) return false;

    const vinculo =
      typeof userData.vinculo === 'string'
        ? userData.vinculo
        : typeof userData.type === 'string'
          ? userData.type
          : '';

    if (vinculo === 'oficina') return true;

    return Boolean(this.resolveOficinaId(userData));
  }

  private oficinaWebUrl(): string {
    const raw =
      this.config.get<string>('OFICINA_WEB_URL') ??
      this.config.get<string>('POSTO_WEB_URL') ??
      'http://localhost:3001';
    return raw.replace(/\/$/, '');
  }

  private async findUserByEmail(
    email: string,
  ): Promise<QueryDocumentSnapshot | null> {
    const snap = await this.firebase
      .getFirestore()
      .collection('users')
      .where('email', '==', email)
      .limit(1)
      .get();

    return snap.empty ? null : snap.docs[0];
  }

  private async findUserByUsuario(
    usuario: string,
  ): Promise<QueryDocumentSnapshot | null> {
    const snap = await this.firebase
      .getFirestore()
      .collection('users')
      .where('usuario', '==', usuario)
      .limit(1)
      .get();

    return snap.empty ? null : snap.docs[0];
  }

  private async matchesEmailPassword(
    password: string,
    userData: FirebaseFirestore.DocumentData | undefined,
  ): Promise<boolean> {
    const storedHash =
      typeof userData?.passwordHash === 'string'
        ? userData.passwordHash
        : TIMING_DUMMY_HASH;

    return bcrypt.compare(password, storedHash);
  }

  private matchesOperacionalPassword(
    password: string,
    userData: FirebaseFirestore.DocumentData | undefined,
  ): boolean {
    const storedHash =
      typeof userData?.senha === 'string' ? userData.senha : TIMING_DUMMY_HASH;

    if (storedHash === TIMING_DUMMY_HASH) {
      void bcrypt.compare(password, TIMING_DUMMY_HASH);
      return false;
    }

    return hashSenhaOperacional(password) === storedHash;
  }

  private isUserActive(
    userData: FirebaseFirestore.DocumentData | undefined,
  ): boolean {
    const status = userData?.status;
    if (typeof status !== 'string' || !status.trim()) {
      return true;
    }

    return status.trim().toUpperCase() === 'ACTIVE';
  }

  private resolveOficinaId(
    userData: FirebaseFirestore.DocumentData | undefined,
  ): string {
    if (typeof userData?.oficinaId === 'string' && userData.oficinaId.trim()) {
      return userData.oficinaId.trim();
    }

    if (typeof userData?.officinaId === 'string' && userData.officinaId.trim()) {
      return userData.officinaId.trim();
    }

    return '';
  }
}
