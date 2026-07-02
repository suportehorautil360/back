import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { FirebaseService } from '../../config/firebase.service';
import { EquipamentosService } from '../equipamentos/equipamentos.service';
import type { ChecklistChegadaDoc } from './checklist-chegada.types';
import { CreateChecklistChegadaDto } from './dto/create-checklist-chegada.dto';
import { UpdateChecklistChegadaFotosDto } from './dto/update-checklist-chegada-fotos.dto';
import {
  buildChecklistChegadaDoc,
  mapChecklistChegadaFromFirestore,
  mapChecklistItems,
  mapPhotos,
} from './helpers/checklist-chegada.mapper';
import { nextNumeroChegada } from './helpers/gerar-numero-chegada.helper';

function texto(valor: unknown): string {
  return typeof valor === 'string' ? valor.trim() : '';
}

@Injectable()
export class ChecklistChegadaService {
  constructor(
    private readonly firebaseService: FirebaseService,
    private readonly equipamentosService: EquipamentosService,
  ) {}

  private get collection() {
    return this.firebaseService.getFirestore().collection('checklistsChegada');
  }

  private get solicitacoesCollection() {
    return this.firebaseService.getFirestore().collection('solicitacoesOS');
  }

  private async equipamentoIdDaSolicitacao(
    solicitacaoOsId: string | null,
  ): Promise<string | null> {
    const solId = texto(solicitacaoOsId);
    if (!solId) return null;
    const snap = await this.solicitacoesCollection.doc(solId).get();
    if (!snap.exists) return null;
    const equipamentoId = texto(
      (snap.data() as Record<string, unknown>).equipamentoId,
    );
    return equipamentoId || null;
  }

  async criar(dto: CreateChecklistChegadaDto): Promise<ChecklistChegadaDoc> {
    const oficinaId = dto.oficinaId.trim();
    if (!oficinaId) {
      throw new BadRequestException('oficinaId é obrigatório.');
    }
    if (!texto(dto.identification?.os)) {
      throw new BadRequestException('identification.os é obrigatório.');
    }

    const id = texto(dto.id) || randomUUID();
    const createdAt = new Date().toISOString();

    try {
      const number =
        texto(dto.number) ||
        (await nextNumeroChegada(this.collection, oficinaId));

      const doc = buildChecklistChegadaDoc(id, number, dto, createdAt);
      await this.collection.doc(id).set(doc);

      const equipamentoId = await this.equipamentoIdDaSolicitacao(
        doc.solicitacaoOsId,
      );
      if (equipamentoId) {
        await this.equipamentosService.syncMedicaoFromChecklist(equipamentoId, {
          hourMeter: doc.identification.hourMeter,
          km: doc.identification.km,
        });
      }

      return doc;
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      console.error('Erro ao criar checklist de chegada:', error);
      throw new InternalServerErrorException(
        'Não foi possível salvar o checklist de chegada.',
      );
    }
  }

  async atualizarFotos(
    id: string,
    dto: UpdateChecklistChegadaFotosDto,
  ): Promise<ChecklistChegadaDoc> {
    const docId = id.trim();
    if (!docId) throw new BadRequestException('id inválido.');

    const temPhotos = dto.photos != null;
    const temInspection = dto.inspection != null;
    const temBlocks = dto.blocks != null;
    if (!temPhotos && !temInspection && !temBlocks) {
      throw new BadRequestException(
        'Informe photos, inspection ou blocks para atualizar.',
      );
    }

    try {
      const ref = this.collection.doc(docId);
      const snap = await ref.get();
      if (!snap.exists) {
        throw new NotFoundException('Checklist de chegada não encontrado.');
      }

      const atual = mapChecklistChegadaFromFirestore(
        snap.id,
        snap.data() as Record<string, unknown>,
      );

      const payload: Record<string, unknown> = {
        updatedAt: new Date().toISOString(),
      };

      if (temPhotos && dto.photos) {
        payload.photos = {
          ...atual.photos,
          ...mapPhotos(dto.photos),
        };
      }
      if (temInspection && dto.inspection) {
        payload.inspection = {
          ...atual.inspection,
          ...mapChecklistItems(dto.inspection),
        };
      }
      if (temBlocks && dto.blocks) {
        payload.blocks = {
          ...atual.blocks,
          ...mapChecklistItems(dto.blocks),
        };
      }

      await ref.update(payload);

      return mapChecklistChegadaFromFirestore(docId, {
        ...(snap.data() as Record<string, unknown>),
        ...payload,
      });
    } catch (error) {
      if (
        error instanceof BadRequestException ||
        error instanceof NotFoundException
      ) {
        throw error;
      }
      console.error('Erro ao atualizar fotos do checklist:', error);
      throw new InternalServerErrorException(
        'Não foi possível atualizar as fotos do checklist.',
      );
    }
  }

  async obter(id: string): Promise<ChecklistChegadaDoc> {
    const docId = id.trim();
    if (!docId) throw new BadRequestException('id inválido.');

    try {
      const snap = await this.collection.doc(docId).get();
      if (!snap.exists) {
        throw new NotFoundException('Checklist de chegada não encontrado.');
      }
      return mapChecklistChegadaFromFirestore(
        snap.id,
        snap.data() as Record<string, unknown>,
      );
    } catch (error) {
      if (
        error instanceof BadRequestException ||
        error instanceof NotFoundException
      ) {
        throw error;
      }
      console.error('Erro ao buscar checklist de chegada:', error);
      throw new InternalServerErrorException(
        'Não foi possível buscar o checklist de chegada.',
      );
    }
  }

  async listarPorOficina(
    oficinaId: string,
  ): Promise<{ data: ChecklistChegadaDoc[]; message: string }> {
    const id = oficinaId.trim();
    if (!id) throw new BadRequestException('oficinaId inválido.');

    try {
      const snap = await this.collection.where('oficinaId', '==', id).get();

      const data = snap.docs
        .map((doc) =>
          mapChecklistChegadaFromFirestore(
            doc.id,
            doc.data() as Record<string, unknown>,
          ),
        )
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

      return {
        data,
        message: 'Checklists de chegada carregados com sucesso.',
      };
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      console.error('Erro ao listar checklists de chegada:', error);
      throw new InternalServerErrorException(
        'Não foi possível listar os checklists de chegada.',
      );
    }
  }
}
