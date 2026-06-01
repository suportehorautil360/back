import {
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { v4 as uuid } from 'uuid';
import { FirebaseService } from '../../config/firebase.service';
import {
  CreateNotificacaoDto,
  DestinatarioTipo,
  NotificacaoTipo,
} from './dto/create-notificacao.dto';

export interface NotificacaoDoc {
  id: string;
  destinatarioTipo: DestinatarioTipo;
  destinatarioId: string;
  prefeituraId: string;
  titulo: string;
  mensagem: string;
  tipo: NotificacaoTipo;
  referenciaTipo?: string | null;
  referenciaId?: string | null;
  lida: boolean;
  createdAt: string;
  updatedAt: string;
}

@Injectable()
export class NotificacoesService {
  constructor(private firebase: FirebaseService) {}

  private get collection() {
    return this.firebase.getFirestore().collection('notificacoes');
  }

  async create(dto: CreateNotificacaoDto): Promise<NotificacaoDoc> {
    const id = uuid();
    const agora = new Date().toISOString();
    const doc: NotificacaoDoc = {
      id,
      destinatarioTipo: dto.destinatarioTipo,
      destinatarioId: dto.destinatarioId,
      prefeituraId: dto.prefeituraId,
      titulo: dto.titulo,
      mensagem: dto.mensagem,
      tipo: dto.tipo ?? 'info',
      referenciaTipo: dto.referenciaTipo ?? null,
      referenciaId: dto.referenciaId ?? null,
      lida: false,
      createdAt: agora,
      updatedAt: agora,
    };
    try {
      await this.collection.doc(id).set(doc);
      return doc;
    } catch (e) {
      console.error('Erro ao criar notificação:', e);
      throw new InternalServerErrorException(
        'Não foi possível criar a notificação.',
      );
    }
  }

  /**
   * Lista as notificações de um destinatário. Mais recentes primeiro.
   * Sem filtro de leitura por padrão (front decide).
   */
  async listar(destinatarioTipo: DestinatarioTipo, destinatarioId: string) {
    try {
      const snap = await this.collection
        .where('destinatarioTipo', '==', destinatarioTipo)
        .where('destinatarioId', '==', destinatarioId)
        .get();
      const data = snap.docs
        .map((d) => d.data() as NotificacaoDoc)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      return { data, message: 'Notificações carregadas.' };
    } catch (e) {
      console.error('Erro ao listar notificações:', e);
      throw new InternalServerErrorException(
        'Não foi possível listar as notificações.',
      );
    }
  }

  async marcarLida(id: string) {
    const ref = this.collection.doc(id);
    const snap = await ref.get();
    if (!snap.exists)
      throw new NotFoundException('Notificação não encontrada.');
    await ref.update({ lida: true, updatedAt: new Date().toISOString() });
    return { data: { id }, message: 'Notificação marcada como lida.' };
  }

  async marcarTodasLidas(
    destinatarioTipo: DestinatarioTipo,
    destinatarioId: string,
  ) {
    const snap = await this.collection
      .where('destinatarioTipo', '==', destinatarioTipo)
      .where('destinatarioId', '==', destinatarioId)
      .where('lida', '==', false)
      .get();
    if (snap.empty) return { data: { atualizadas: 0 }, message: 'Tudo lido.' };
    const batch = this.firebase.getFirestore().batch();
    const agora = new Date().toISOString();
    snap.docs.forEach((d) =>
      batch.update(d.ref, { lida: true, updatedAt: agora }),
    );
    await batch.commit();
    return {
      data: { atualizadas: snap.size },
      message: 'Notificações marcadas como lidas.',
    };
  }
}
