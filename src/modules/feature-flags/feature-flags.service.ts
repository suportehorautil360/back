import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { v4 as uuid } from 'uuid';
import { FirebaseService } from '../../config/firebase.service';
import { UpsertFeatureFlagsDto } from './dto/upsert-feature-flags.dto';

type Flags = Record<string, boolean>;

@Injectable()
export class FeatureFlagsService {
  constructor(private firebaseService: FirebaseService) {}

  private get collection() {
    return this.firebaseService.getFirestore().collection('featureFlags');
  }

  /** Flags da prefeitura (objeto vazio se não houver). */
  async obter(prefeituraId: string): Promise<Flags> {
    try {
      const snap = await this.collection
        .where('prefeituraId', '==', prefeituraId)
        .get();
      if (snap.empty) return {};
      const data = snap.docs[0].data() as { flags?: Flags };
      return data.flags ?? {};
    } catch (error) {
      console.error('Erro ao buscar feature flags:', error);
      throw new InternalServerErrorException(
        'Não foi possível buscar as funcionalidades.',
      );
    }
  }

  /** Uma funcionalidade está ativa? (default: false / opt-in). */
  async ativo(prefeituraId: string, feature: string): Promise<boolean> {
    const flags = await this.obter(prefeituraId);
    return flags[feature] === true;
  }

  async salvar(dto: UpsertFeatureFlagsDto) {
    try {
      const snap = await this.collection
        .where('prefeituraId', '==', dto.prefeituraId)
        .get();
      const dados = {
        prefeituraId: dto.prefeituraId,
        flags: dto.flags,
        atualizadoEm: new Date().toISOString(),
      };
      if (snap.empty) {
        await this.collection.doc().set({ id: uuid(), ...dados });
      } else {
        await this.collection.doc(snap.docs[0].id).update(dados);
      }
      return { data: dados.flags, message: 'Funcionalidades salvas!' };
    } catch (error) {
      console.error('Erro ao salvar feature flags:', error);
      throw new InternalServerErrorException(
        'Não foi possível salvar as funcionalidades.',
      );
    }
  }
}
