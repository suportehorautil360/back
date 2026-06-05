import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { FirebaseService } from '../../config/firebase.service';
import { mapAbastecimento } from './abastecimentos.mapper';

@Injectable()
export class AbastecimentosService {
  constructor(private firebaseService: FirebaseService) {}

  private get collection() {
    return this.firebaseService.getFirestore().collection('abastecimentos');
  }

  /** Lista os abastecimentos da prefeitura no shape unificado (Comboio/Posto). */
  async listar(prefeituraId: string) {
    try {
      const snap = await this.collection
        .where('prefeituraId', '==', prefeituraId)
        .get();
      const data = snap.docs.map((d) =>
        mapAbastecimento({ id: d.id, ...d.data() }),
      );
      return { data, message: 'Abastecimentos buscados com sucesso!' };
    } catch (error) {
      console.error('Erro ao buscar abastecimentos:', error);
      throw new InternalServerErrorException(
        'Não foi possível buscar os abastecimentos.',
      );
    }
  }
}
