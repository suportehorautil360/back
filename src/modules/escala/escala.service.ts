import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { FirebaseService } from '../../config/firebase.service';
import { UpsertEscalaDto } from './dto/upsert-escala.dto';

@Injectable()
export class EscalaService {
  constructor(private firebaseService: FirebaseService) {}

  private get collection() {
    return this.firebaseService.getFirestore().collection('escalas');
  }

  /** Uma escala por prefeitura: devolve a existente ou null. */
  async obter(prefeituraId: string) {
    try {
      const snap = await this.collection
        .where('prefeituraId', '==', prefeituraId)
        .get();
      const data = snap.empty ? null : snap.docs[0].data();
      return { data, message: 'Escala buscada com sucesso!' };
    } catch (error) {
      console.error('Erro ao buscar escala:', error);
      throw new InternalServerErrorException(
        'Não foi possível buscar a escala.',
      );
    }
  }

  /** Cria ou atualiza a escala da prefeitura (upsert por prefeituraId). */
  async salvar(dto: UpsertEscalaDto) {
    try {
      const snap = await this.collection
        .where('prefeituraId', '==', dto.prefeituraId)
        .get();

      const dados = {
        prefeituraId: dto.prefeituraId,
        inicio: dto.inicio,
        fim: dto.fim,
        diasSemana: dto.diasSemana,
        almocoMinutos: dto.almocoMinutos,
        atualizadoEm: new Date().toISOString(),
      };

      if (snap.empty) {
        const novo = { id: randomUUID(), ...dados };
        await this.collection.doc().set(novo);
        return { data: novo, message: 'Escala criada com sucesso!' };
      }

      const docId = snap.docs[0].id;
      await this.collection.doc(docId).update(dados);
      return { data: dados, message: 'Escala atualizada com sucesso!' };
    } catch (error) {
      console.error('Erro ao salvar escala:', error);
      throw new InternalServerErrorException(
        'Não foi possível salvar a escala.',
      );
    }
  }
}

