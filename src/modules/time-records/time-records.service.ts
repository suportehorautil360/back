import {
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { v4 as uuid } from 'uuid';
import { FirebaseService } from '../../config/firebase.service';
import { FeatureFlagsService } from '../feature-flags/feature-flags.service';
import { CreateTimeRecordDto } from './dto/create-time-record.dto';
import { UpdateTimeRecordDto } from './dto/update-time-record.dto';

@Injectable()
export class TimeRecordsService {
  constructor(
    private firebaseService: FirebaseService,
    private featureFlags: FeatureFlagsService,
  ) {}

  private get collection() {
    return this.firebaseService.getFirestore().collection('timeRecords');
  }

  /**
   * Versão legível em horário de Brasília (ex.: "26/05/2026 18:07") só para
   * leitura/auditoria no console. A fonte de verdade segue em UTC
   * (timestampOriginal).
   */
  private horaLocalBR(iso: string): string {
    const d = new Date(iso);
    const tz = 'America/Sao_Paulo';
    const data = d.toLocaleDateString('pt-BR', {
      timeZone: tz,
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });
    const hora = d.toLocaleTimeString('pt-BR', {
      timeZone: tz,
      hour: '2-digit',
      minute: '2-digit',
    });
    return `${data} ${hora}`;
  }

  async create(dto: CreateTimeRecordDto) {
    if (!(await this.featureFlags.ativo(dto.prefeituraId, 'ponto'))) {
      throw new ForbiddenException(
        'O ponto não está ativo para esta prefeitura.',
      );
    }
    const id = uuid();
    try {
      const novo = {
        id,
        name: dto.name,
        photo: dto.photo,
        prefeituraId: dto.prefeituraId,
        timestampOriginal: dto.timestampOriginal,
        horaLocalBR: this.horaLocalBR(dto.timestampOriginal),
        tipo: dto.tipo,
        status: 'pendente',
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

  async update(id: string, dto: UpdateTimeRecordDto) {
    try {
      const snap = await this.collection.where('id', '==', id).get();
      if (snap.empty) {
        throw new NotFoundException('Batida não encontrada para o ID fornecido.');
      }
      const docId = snap.docs[0].id;
      // Correção feita pelo operador: o motivo acompanha a alteração e a
      // batida volta para "pendente" para o RH avaliar de novo.
      const patch: Record<string, unknown> = {
        timestampOriginal: dto.timestampOriginal,
        horaLocalBR: this.horaLocalBR(dto.timestampOriginal),
        updatedAt: new Date().toISOString(),
      };
      if (dto.motivo?.trim()) {
        patch.motivoCorrecao = dto.motivo.trim();
        patch.status = 'pendente';
        patch.motivoReprovacao = null;
      }
      await this.collection.doc(docId).update(patch);
      return { data: {}, message: 'Batida atualizada com sucesso!' };
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      console.error('Erro ao atualizar ponto:', error);
      throw new InternalServerErrorException(
        'Não foi possível atualizar a batida. Tente novamente mais tarde.',
      );
    }
  }

  /** Atualiza o status de avaliação (aprovado/reprovado) de uma batida. */
  private async avaliar(
    id: string,
    patch: { status: string; motivoReprovacao?: string },
  ) {
    const snap = await this.collection.where('id', '==', id).get();
    if (snap.empty) {
      throw new NotFoundException('Batida não encontrada para o ID fornecido.');
    }
    const docId = snap.docs[0].id;
    await this.collection.doc(docId).update({
      ...patch,
      avaliadoEm: new Date().toISOString(),
    });
    return { data: {}, message: 'Status atualizado com sucesso!' };
  }

  async aprovar(id: string) {
    try {
      return await this.avaliar(id, { status: 'aprovado' });
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      console.error('Erro ao aprovar ponto:', error);
      throw new InternalServerErrorException(
        'Não foi possível aprovar a batida. Tente novamente mais tarde.',
      );
    }
  }

  async reprovar(id: string, motivo: string) {
    try {
      return await this.avaliar(id, {
        status: 'reprovado',
        motivoReprovacao: motivo,
      });
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      console.error('Erro ao reprovar ponto:', error);
      throw new InternalServerErrorException(
        'Não foi possível reprovar a batida. Tente novamente mais tarde.',
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
