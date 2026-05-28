import {
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { v4 as uuid } from 'uuid';
import { FirebaseService } from '../../config/firebase.service';
import {
  CreateSolicitacaoPontoDto,
  TipoSolicitacao,
} from './dto/create-solicitacao-ponto.dto';

export type StatusSolicitacao = 'pendente' | 'aprovado' | 'reprovado';

export interface SolicitacaoDoc {
  id: string;
  tipo: TipoSolicitacao;
  status: StatusSolicitacao;
  prefeituraId: string;
  name: string;
  cpf?: string | null;
  batidaId?: string | null;
  data?: string | null;
  timestampOriginal?: string | null;
  observacao?: string | null;
  anexoDataUrl?: string | null;
  anexoNome?: string | null;
  motivoReprovacao?: string | null;
  createdAt: string;
  updatedAt: string;
}

@Injectable()
export class SolicitacoesPontoService {
  constructor(private firebase: FirebaseService) {}

  private get collection() {
    return this.firebase.getFirestore().collection('solicitacoesPonto');
  }

  /** Coleção de batidas (para aprovar/cancelar refletir lá quando aplicável). */
  private get timeRecords() {
    return this.firebase.getFirestore().collection('timeRecords');
  }

  async create(dto: CreateSolicitacaoPontoDto) {
    try {
      const id = uuid();
      const agora = new Date().toISOString();
      const doc: SolicitacaoDoc = {
        id,
        tipo: dto.tipo,
        status: 'pendente',
        prefeituraId: dto.prefeituraId,
        name: dto.name,
        cpf: dto.cpf ?? null,
        batidaId: dto.batidaId ?? null,
        data: dto.data ?? null,
        timestampOriginal: dto.timestampOriginal ?? null,
        observacao: dto.observacao ?? null,
        anexoDataUrl: dto.anexoDataUrl ?? null,
        anexoNome: dto.anexoNome ?? null,
        createdAt: agora,
        updatedAt: agora,
      };
      await this.collection.doc(id).set(doc);
      return { data: doc, message: 'Solicitação criada com sucesso!' };
    } catch (e) {
      console.error('Erro ao criar solicitação de ponto:', e);
      throw new InternalServerErrorException(
        'Não foi possível registrar a solicitação. Tente novamente.',
      );
    }
  }

  async listar(prefeituraId: string) {
    try {
      const snap = await this.collection
        .where('prefeituraId', '==', prefeituraId)
        .get();
      const data = snap.docs
        .map((d) => d.data() as SolicitacaoDoc)
        // Mais recentes primeiro.
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      return { data, message: 'Solicitações carregadas.' };
    } catch (e) {
      console.error('Erro ao listar solicitações de ponto:', e);
      throw new InternalServerErrorException(
        'Não foi possível listar as solicitações.',
      );
    }
  }

  /**
   * Aprova a solicitação. Para tipo=incluir, cria a batida correspondente
   * em timeRecords. Para tipo=cancelar, marca a batida referenciada como
   * cancelada. Os outros tipos só mudam o status (a ação é interpretativa).
   */
  async aprovar(id: string) {
    const snap = await this.collection.doc(id).get();
    if (!snap.exists) {
      throw new NotFoundException('Solicitação não encontrada.');
    }
    const doc = snap.data() as SolicitacaoDoc;
    if (doc.status !== 'pendente') {
      return { data: doc, message: 'Solicitação já foi avaliada.' };
    }

    try {
      if (doc.tipo === 'incluir' && doc.timestampOriginal) {
        const batidaId = uuid();
        await this.timeRecords.doc(batidaId).set({
          id: batidaId,
          prefeituraId: doc.prefeituraId,
          name: doc.name,
          tipo: 'entrada',
          timestampOriginal: doc.timestampOriginal,
          horaLocalBR: new Date(doc.timestampOriginal).toLocaleString('pt-BR', {
            timeZone: 'America/Sao_Paulo',
          }),
          status: 'aprovado',
          origem: 'solicitacao-inclusao',
          solicitacaoId: doc.id,
          createdAt: new Date().toISOString(),
        });
      } else if (doc.tipo === 'cancelar' && doc.batidaId) {
        const batidaSnap = await this.timeRecords
          .where('id', '==', doc.batidaId)
          .get();
        if (!batidaSnap.empty) {
          await this.timeRecords.doc(batidaSnap.docs[0].id).update({
            status: 'cancelado',
            canceladoPorSolicitacao: doc.id,
            updatedAt: new Date().toISOString(),
          });
        }
      }

      const updated: SolicitacaoDoc = {
        ...doc,
        status: 'aprovado',
        motivoReprovacao: null,
        updatedAt: new Date().toISOString(),
      };
      await this.collection.doc(id).set(updated);
      return { data: updated, message: 'Solicitação aprovada.' };
    } catch (e) {
      console.error('Erro ao aprovar solicitação:', e);
      throw new InternalServerErrorException(
        'Não foi possível aprovar a solicitação.',
      );
    }
  }

  async reprovar(id: string, motivo: string) {
    const snap = await this.collection.doc(id).get();
    if (!snap.exists) {
      throw new NotFoundException('Solicitação não encontrada.');
    }
    const doc = snap.data() as SolicitacaoDoc;
    const updated: SolicitacaoDoc = {
      ...doc,
      status: 'reprovado',
      motivoReprovacao: motivo,
      updatedAt: new Date().toISOString(),
    };
    await this.collection.doc(id).set(updated);
    return { data: updated, message: 'Solicitação reprovada.' };
  }
}
