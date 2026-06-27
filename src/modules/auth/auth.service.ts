import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import type { StringValue } from 'ms';
import type { QueryDocumentSnapshot } from 'firebase-admin/firestore';
import { FirebaseService } from '../../config/firebase.service';
import { mapOficinaListItem } from '../oficinas/helpers/oficinas-list.helper';
import { hashSenhaOperacional } from '../parceiros/helpers/parceiro-login.helper';
import {
  computeCredLevel,
  type CredChecklist,
} from './domain/cred-checklist.policy';
import { LoginDto } from './dto/login.dto';

const TIMING_DUMMY_HASH = bcrypt.hashSync('_timing_', 12);

const INVALID_CREDENTIALS = 'Credenciais inválidas.';

@Injectable()
export class AuthService {
  constructor(
    private readonly firebase: FirebaseService,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
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
      },
      ...(oficina ? { oficina } : {}),
    };
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
