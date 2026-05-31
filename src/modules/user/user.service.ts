import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { StringValue } from 'ms';
import { FirebaseService } from '../../config/firebase.service';
import { LoginUserDto } from './dto/login-user.dto';

type UsuarioAuth = {
  nome: string;
  usuario: string;
  senha: string;
  perfil: string;
  vinculo: string;
  prefeituraId: string;
  postoId?: string;
};

@Injectable()
export class UserService {
  constructor(
    private readonly configService: ConfigService,
    private readonly jwtService: JwtService,
    private readonly firebase: FirebaseService,
  ) {}

  private get usersCollection() {
    return this.firebase.getFirestore().collection('users');
  }

  async login(dto: LoginUserDto) {
    const user = await this.tryFirestoreLogin(dto);

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

    return {
      ok: true,
      user,
      accessToken,
      tokenType: 'Bearer',
      expiresIn,
      message: 'Login realizado com sucesso.',
    };
  }

  private async tryFirestoreLogin(
    dto: LoginUserDto,
  ): Promise<UsuarioAuth | null> {
    try {
      const snap = await this.usersCollection
        .where('usuario', '==', dto.usuario)
        .get();

      if (snap.empty) {
        return null;
      }

      const senhaHash = this.hashSenha(dto.senha);

      for (const doc of snap.docs) {
        const data = doc.data() as Record<string, unknown>;
        const senhaSalva = this.toSafeString(data.senha);
        if (senhaSalva !== senhaHash) {
          continue;
        }

        return {
          nome: this.toSafeString(data.nome) || dto.usuario,
          usuario: this.toSafeString(data.usuario) || dto.usuario,
          senha: senhaSalva,
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

      return null;
    } catch {
      return null;
    }
  }

  private getJwtSecret(): string {
    const jwtSecret = this.configService.get<string>('JWT_SECRET') ?? '';
    if (!jwtSecret) {
      throw new Error('JWT_SECRET nao configurado no ambiente.');
    }
    return jwtSecret;
  }

  private hashSenha(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }

  private toSafeString(value: unknown): string {
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'boolean') {
      return String(value);
    }
    return '';
  }
}
