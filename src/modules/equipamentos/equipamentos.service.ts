import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { FirebaseService } from '../../config/firebase.service';
import { v4 as uuid } from 'uuid';
import { CreateEquipamentoDto } from './dto/create-equipamento.dto';
import { UpdateEquipamentoDto } from './dto/update-equipamento.dto';
import { CompleteRevisaoEquipDto } from './dto/complete-revisao-equip.dto';

@Injectable()
export class EquipamentosService {
  constructor(private firebaseService: FirebaseService) {}

  private get collection() {
    return this.firebaseService.getFirestore().collection('equipamentos');
  }

  private get revisoesCollection() {
    return this.firebaseService
      .getFirestore()
      .collection('equipamentos_revisoes');
  }

  /**
   * Localiza o documento pelo campo `id` salvo (docs novos) ou, em fallback,
   * pelo id do próprio documento Firestore (docs legados sem o campo `id`).
   */
  private async findDocByField(id: string) {
    const ref = await this.collection.where('id', '==', id).get();
    if (!ref.empty) return ref.docs[0];

    const byDocId = await this.collection.doc(id).get();
    if (byDocId.exists) return byDocId;

    throw new NotFoundException(
      'Equipamento não encontrado para o ID fornecido.',
    );
  }

  async create(dto: CreateEquipamentoDto) {
    const id = uuid();
    try {
      const novo = {
        id,
        ...dto,
        label: dto.descricao,
        status: dto.status ?? 'ativo',
        createdAt: new Date().toISOString(),
      };
      await this.collection.doc().set(novo);
      return { data: novo, message: 'Equipamento criado com sucesso!' };
    } catch (error) {
      console.error('Erro ao salvar equipamento:', error);
      throw new InternalServerErrorException(
        'Não foi possível salvar o equipamento no banco de dados.',
      );
    }
  }

  /** Busca um equipamento pelo campo `id` (documento bruto). */
  async findById(id: string) {
    const doc = await this.findDocByField(id);
    return { data: doc.data(), message: 'Equipamento encontrado.' };
  }

  /** Lista os equipamentos da prefeitura. Sem registros => lista vazia (200). */
  async findAllByPrefeitura(prefeituraId: string) {
    try {
      const ref = await this.collection
        .where('prefeituraId', '==', prefeituraId)
        .get();
      // Garante um `id` utilizável: o campo salvo (docs novos) ou, em fallback,
      // o id do documento Firestore (docs legados sem o campo `id`).
      const data = ref.docs.map((doc) => {
        const raw = doc.data();
        return { ...raw, id: (raw as { id?: string }).id ?? doc.id };
      });
      return { data, message: 'Equipamentos buscados com sucesso!' };
    } catch (error) {
      console.error('Erro ao buscar equipamentos:', error);
      throw new InternalServerErrorException(
        'Não foi possível buscar os equipamentos no banco de dados.',
      );
    }
  }

  async updateById(id: string, dto: UpdateEquipamentoDto) {
    try {
      const doc = await this.findDocByField(id);

      // Só grava os campos informados (evita sobrescrever com undefined).
      const patch: Record<string, unknown> = {
        updatedAt: new Date().toISOString(),
      };
      for (const [key, value] of Object.entries(dto)) {
        if (value !== undefined) patch[key] = value;
      }

      await this.collection.doc(doc.id).update(patch);
      return { data: {}, message: 'Equipamento atualizado com sucesso!' };
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      console.error('Erro ao atualizar equipamento:', error);
      throw new InternalServerErrorException(
        'Não foi possível atualizar o equipamento no banco de dados.',
      );
    }
  }

  async deleteById(id: string) {
    try {
      const doc = await this.findDocByField(id);
      await this.collection.doc(doc.id).delete();
      return { data: {}, message: 'Equipamento removido com sucesso!' };
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      console.error('Erro ao remover equipamento:', error);
      throw new InternalServerErrorException(
        'Não foi possível remover o equipamento no banco de dados.',
      );
    }
  }

  /**
   * Registra uma revisão concluída e libera o equipamento: grava a revisão no
   * histórico, adota a leitura informada como leitura atual e base da próxima
   * revisão, e devolve o equipamento para o status "ativo".
   */
  async completeRevision(dto: CompleteRevisaoEquipDto) {
    const revisionId = uuid();
    try {
      const doc = await this.findDocByField(dto.equipamentoId);
      const data = doc.data() as { medicaoAtual?: number };

      if (dto.odometerReading < (data.medicaoAtual ?? 0)) {
        throw new BadRequestException(
          'A leitura não pode ser menor que a medição atual do equipamento.',
        );
      }

      const novaRevisao = {
        id: revisionId,
        ...dto,
        status: 'Concluída',
        createdAt: new Date().toISOString(),
      };
      await this.revisoesCollection.doc().set(novaRevisao);

      await this.collection.doc(doc.id).update({
        medicaoAtual: dto.odometerReading,
        ultimaRevisao: dto.odometerReading,
        status: 'ativo',
        updatedAt: new Date().toISOString(),
      });

      return {
        data: novaRevisao,
        message: 'Revisão concluída e equipamento liberado com sucesso!',
      };
    } catch (error) {
      if (
        error instanceof BadRequestException ||
        error instanceof NotFoundException
      ) {
        throw error;
      }
      console.error('Erro ao concluir revisão do equipamento:', error);
      throw new InternalServerErrorException(
        'Não foi possível concluir a revisão. Tente novamente mais tarde.',
      );
    }
  }
}
