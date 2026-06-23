import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { FirebaseService } from '../../config/firebase.service';
import { mapOficinaListItem } from './helpers/oficinas-list.helper';
import type { OficinaListItem } from './oficinas.types';

@Injectable()
export class OficinasService {
  constructor(private readonly firebaseService: FirebaseService) {}

  private get collection() {
    return this.firebaseService.getFirestore().collection('oficinas');
  }

  /** Lista todas as oficinas da coleção `oficinas`. */
  async listar(): Promise<{ data: OficinaListItem[]; message: string }> {
    try {
      const snap = await this.collection.get();

      const data = snap.docs
        .map((doc) =>
          mapOficinaListItem(doc.id, doc.data() as Record<string, unknown>),
        )
        .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));

      return {
        data,
        message: 'Oficinas carregadas com sucesso.',
      };
    } catch (error) {
      console.error('Erro ao listar oficinas:', error);
      throw new InternalServerErrorException(
        'Não foi possível listar as oficinas.',
      );
    }
  }
}
