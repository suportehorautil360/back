import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { v4 as uuid } from 'uuid';
import { FirebaseService } from '../../config/firebase.service';
import { UpsertConfiguracaoDto } from './dto/upsert-configuracao.dto';

@Injectable()
export class ConfiguracoesService {
  constructor(private firebaseService: FirebaseService) {}

  private get collection() {
    return this.firebaseService.getFirestore().collection('configuracoes');
  }

  /** Uma configuração por prefeitura: devolve a existente ou null. */
  async obter(prefeituraId: string) {
    try {
      const snap = await this.collection
        .where('prefeituraId', '==', prefeituraId)
        .get();
      const data = snap.empty ? null : snap.docs[0].data();
      return { data, message: 'Configuração buscada com sucesso!' };
    } catch (error) {
      console.error('Erro ao buscar configuração:', error);
      throw new InternalServerErrorException(
        'Não foi possível buscar a configuração.',
      );
    }
  }

  /** Cria ou atualiza a configuração da prefeitura (upsert por prefeituraId). */
  async salvar(dto: UpsertConfiguracaoDto) {
    try {
      const snap = await this.collection
        .where('prefeituraId', '==', dto.prefeituraId)
        .get();

      const dados = {
        prefeituraId: dto.prefeituraId,
        empresa: dto.empresa ?? {},
        alertas: dto.alertas ?? {},
        intervalos: dto.intervalos ?? {},
        bloqueio: dto.bloqueio ?? {},
        atualizadoEm: new Date().toISOString(),
      };

      if (snap.empty) {
        const novo = { id: uuid(), ...dados };
        await this.collection.doc().set(novo);
        return { data: novo, message: 'Configuração criada com sucesso!' };
      }

      const docId = snap.docs[0].id;
      await this.collection.doc(docId).set(dados, { merge: true });
      return { data: dados, message: 'Configuração atualizada com sucesso!' };
    } catch (error) {
      console.error('Erro ao salvar configuração:', error);
      throw new InternalServerErrorException(
        'Não foi possível salvar a configuração.',
      );
    }
  }
}
