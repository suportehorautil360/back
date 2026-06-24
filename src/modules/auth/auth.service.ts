import {
  Injectable,
  InternalServerErrorException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import type { StringValue } from 'ms';
import { FirebaseService } from '../../config/firebase.service';
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
    const snap = await this.firebase
      .getFirestore()
      .collection('users')
      .where('email', '==', dto.email)
      .limit(1)
      .get();

    const doc = snap.empty ? null : snap.docs[0];
    const userData = doc?.data();

    const storedHash =
      typeof userData?.passwordHash === 'string'
        ? userData.passwordHash
        : TIMING_DUMMY_HASH;

    const match = await bcrypt.compare(dto.password, storedHash);

    if (!doc || !match) {
      throw new UnauthorizedException(INVALID_CREDENTIALS);
    }

    if (userData?.status !== 'ACTIVE') {
      throw new UnauthorizedException(INVALID_CREDENTIALS);
    }

    const oficinaId =
      typeof userData.oficinaId === 'string' ? userData.oficinaId : '';

    const oficinasDoc = await this.firebase
      .getFirestore()
      .collection('oficinas')
      .doc(oficinaId)
      .get();

    const credChecklist = oficinasDoc.exists
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
        sub: toStr(userData.id),
        oficinaId: toStr(userData.oficinaId),
        prefeituraId: toStr(userData.prefeituraId),
        credLevel,
      },
      { secret, expiresIn: expiresIn as StringValue },
    );

    return {
      token,
      user: {
        id: toStr(userData.id),
        name: toStr(userData.name),
        email: toStr(userData.email),
        oficinaId: toStr(userData.oficinaId),
        prefeituraId: toStr(userData.prefeituraId),
      },
    };
  }
}
