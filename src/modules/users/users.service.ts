import {
  ConflictException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import * as admin from 'firebase-admin';
import { randomUUID } from 'node:crypto';
import { FirebaseService } from '../../config/firebase.service';
import { CreateUserDto } from './dto/create-user.dto';

const BCRYPT_ROUNDS = 12;

@Injectable()
export class UsersService {
  constructor(private readonly firebase: FirebaseService) {}

  private get usersCollection() {
    return this.firebase.getFirestore().collection('users');
  }

  private get oficinasCollection() {
    return this.firebase.getFirestore().collection('oficinas');
  }

  async registerUser(dto: CreateUserDto) {
    try {
      const existing = await this.usersCollection
        .where('email', '==', dto.email)
        .limit(1)
        .get();

      if (!existing.empty) {
        throw new ConflictException('Email já cadastrado.');
      }

      const id = randomUUID();
      const passwordHash = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);

      await this.usersCollection.doc(id).set({
        id,
        name: dto.name,
        email: dto.email,
        passwordHash,
        oficinaId: dto.oficinaId,
        prefeituraId: dto.prefeituraId,
        status: 'ACTIVE',
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      return {
        data: {
          id,
          name: dto.name,
          email: dto.email,
          oficinaId: dto.oficinaId,
          prefeituraId: dto.prefeituraId,
          status: 'ACTIVE',
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
      let userDoc = await this.usersCollection.doc(userId).get();

      if (!userDoc.exists) {
        const snap = await this.usersCollection
          .where('id', '==', userId)
          .limit(1)
          .get();
        userDoc = snap.empty ? userDoc : snap.docs[0];
      }

      if (!userDoc.exists) {
        throw new NotFoundException('Usuário não encontrado.');
      }

      const raw = userDoc.data() as Record<string, unknown>;
      const toStr = (v: unknown) => (typeof v === 'string' ? v : '');

      const oficinaId =
        toStr(raw.oficinaId) ||
        toStr(raw.officinaId);

      const user = {
        id: userDoc.id,
        name: toStr(raw.name) || toStr(raw.nome),
        email: toStr(raw.email),
        usuario: toStr(raw.usuario),
        oficinaId,
        prefeituraId: toStr(raw.prefeituraId),
        status: toStr(raw.status) || 'ACTIVE',
        credLevel,
      };

      const oficinasDoc = await this.oficinasCollection
        .doc(oficinaId)
        .get();
      const oficina = oficinasDoc.exists
        ? { id: oficinasDoc.id, ...oficinasDoc.data() }
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
