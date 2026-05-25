import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { v4 as uuid } from 'uuid';
import { FirebaseService } from '../../config/firebase.service';
import { CreateTimeRecordDto } from './dto/create-time-record.dto';

@Injectable()
export class TimeRecordsService {
  constructor(private firebaseService: FirebaseService) {}

  private get collection() {
    return this.firebaseService.getFirestore().collection('timeRecords');
  }

  async create(dto: CreateTimeRecordDto) {
    const id = uuid();
    try {
      const novo = {
        id,
        name: dto.name,
        photo: dto.photo,
        prefeituraId: dto.prefeituraId,
        timestampOriginal: dto.timestampOriginal,
        createdAt: new Date().toISOString(),
      };
      await this.collection.doc().set(novo);
      return { data: novo, message: 'Ponto registrado com sucesso!' };
    } catch (error) {
      console.error('Erro ao registrar ponto:', error);
      throw new InternalServerErrorException(
        'Não foi possível registrar o ponto. Tente novamente mais tarde.',
      );
    }
  }

  async findAllById(prefeituraId: string) {
    try {
      const snap = await this.collection
        .where('prefeituraId', '==', prefeituraId)
        .get();

      // Lista vazia é resultado válido (200, não 404) — sem batidas ainda.
      const data = snap.docs.map((doc) => doc.data());
      return { data, message: 'Pontos buscados com sucesso!' };
    } catch (error) {
      console.error('Erro ao buscar pontos:', error);
      throw new InternalServerErrorException(
        'Não foi possível buscar os pontos. Tente novamente mais tarde.',
      );
    }
  }
}
