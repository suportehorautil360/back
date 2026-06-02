import {
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { FirebaseService } from '../../config/firebase.service';
import {
  CreateSolicitacaoPontoDto,
  TipoSolicitacao,
} from './dto/create-solicitacao-ponto.dto';
import { NotificacoesService } from '../notificacoes/notificacoes.service';
import { AbonosService } from '../abonos/abonos.service';

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
  constructor(
    private firebase: FirebaseService,
    private notificacoes: NotificacoesService,
    private abonos: AbonosService,
  ) {}

  private get collection() {
    return this.firebase.getFirestore().collection('solicitacoesPonto');
  }

  /** Coleção de batidas (para aprovar/cancelar refletir lá quando aplicável). */
  private get timeRecords() {
    return this.firebase.getFirestore().collection('timeRecords');
  }

  private rotuloTipo(tipo: TipoSolicitacao): string {
    return {
      incluir: 'Incluir batida',
      cancelar: 'Cancelar batida',
      abono: 'Solicitar abono',
      mensagem: 'Mensagem',
    }[tipo];
  }

  async create(dto: CreateSolicitacaoPontoDto) {
    try {
      const id = randomUUID();
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

      // Notifica o RH (broadcast pra prefeitura) que tem solicitação nova.
      // Falhar a notificação não deve quebrar a criação da solicitação.
      try {
        await this.notificacoes.create({
          destinatarioTipo: 'rh',
          destinatarioId: dto.prefeituraId,
          prefeituraId: dto.prefeituraId,
          tipo: 'info',
          titulo: `Nova solicitação: ${this.rotuloTipo(dto.tipo)}`,
          mensagem: `${dto.name} enviou uma solicitação${
            dto.observacao ? `: "${dto.observacao.slice(0, 120)}"` : '.'
          }`,
          referenciaTipo: 'solicitacao-ponto',
          referenciaId: id,
        });
      } catch (notifErr) {
        console.warn('Não foi possível notificar o RH:', notifErr);
      }

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
        const batidaId = randomUUID();
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
      } else if (doc.tipo === 'abono' && doc.data && doc.cpf) {
        // Aprovar abono cria um registro na coleção `abonos` — o front
        // consulta para classificar o dia como 'abonado' em vez de 'falta'
        // e respeitar o saldo. Sem CPF não dá pra casar o dia com o
        // funcionário, então a aprovação só muda o status (RH age fora).
        try {
          await this.abonos.criar({
            prefeituraId: doc.prefeituraId,
            funcionarioCpf: doc.cpf.replace(/\D/g, ''),
            funcionarioNome: doc.name,
            data: doc.data,
            motivo: doc.observacao ?? null,
            solicitacaoId: doc.id,
          });
        } catch (abonoErr) {
          console.warn('Não foi possível criar abono:', abonoErr);
        }
      }

      const updated: SolicitacaoDoc = {
        ...doc,
        status: 'aprovado',
        motivoReprovacao: null,
        updatedAt: new Date().toISOString(),
      };
      await this.collection.doc(id).set(updated);

      // Notifica o funcionário (se identificável por CPF).
      if (doc.cpf) {
        try {
          await this.notificacoes.create({
            destinatarioTipo: 'funcionario',
            destinatarioId: doc.cpf,
            prefeituraId: doc.prefeituraId,
            tipo: 'sucesso',
            titulo: `${this.rotuloTipo(doc.tipo)} aprovada`,
            mensagem: `Sua solicitação foi aprovada pelo gestor.`,
            referenciaTipo: 'solicitacao-ponto',
            referenciaId: doc.id,
          });
        } catch (notifErr) {
          console.warn('Não foi possível notificar funcionário:', notifErr);
        }
      }

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

    if (doc.cpf) {
      try {
        await this.notificacoes.create({
          destinatarioTipo: 'funcionario',
          destinatarioId: doc.cpf,
          prefeituraId: doc.prefeituraId,
          tipo: 'erro',
          titulo: `${this.rotuloTipo(doc.tipo)} reprovada`,
          mensagem: `Motivo: ${motivo}`,
          referenciaTipo: 'solicitacao-ponto',
          referenciaId: doc.id,
        });
      } catch (notifErr) {
        console.warn('Não foi possível notificar funcionário:', notifErr);
      }
    }

    return { data: updated, message: 'Solicitação reprovada.' };
  }
}

