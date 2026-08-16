import {
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { FirebaseService } from '../../config/firebase.service';
import {
  CreateSolicitacaoPontoDto,
  TipoBatida,
  TipoSolicitacao,
} from './dto/create-solicitacao-ponto.dto';
import { NotificacoesService } from '../notificacoes/notificacoes.service';
import { AbonosService } from '../abonos/abonos.service';
import { selarRegistro } from '../../common/ledger/ponto-ledger';

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
  /** Para tipo "incluir": qual batida do dia. Default "entrada". */
  tipoBatida?: TipoBatida | null;
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
        tipoBatida: dto.tipoBatida ?? null,
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

    const db = this.firebase.getFirestore();
    try {
      if (doc.tipo === 'incluir' && doc.timestampOriginal) {
        // Inclusão de batida esquecida: entra no ledger como um AJUSTE
        // (sem `refNsr`, pois não corrige nenhuma original) já aplicado,
        // com NSR sequencial e hash encadeado (Portaria 671).
        const batidaId = randomUUID();
        const ts = doc.timestampOriginal;
        // Slot da batida pedido pelo operador (entrada/almoco/volta/saida).
        // Compat. legado: solicitações antigas sem `tipoBatida` caem em 'entrada'.
        const tipoBatida: TipoBatida = doc.tipoBatida ?? 'entrada';
        await db.runTransaction(async (tx) => {
          const selo = await selarRegistro(db, tx, {
            prefeituraId: doc.prefeituraId,
            identificador: doc.cpf?.replace(/\D/g, '') || doc.name,
            tipo: tipoBatida,
            timestampOriginal: ts,
            registro: 'ajuste',
            refNsr: null,
          });
          tx.set(this.timeRecords.doc(batidaId), {
            id: batidaId,
            prefeituraId: doc.prefeituraId,
            name: doc.name,
            cpf: doc.cpf ?? null,
            tipo: tipoBatida,
            timestampOriginal: ts,
            horaLocalBR: new Date(ts).toLocaleString('pt-BR', {
              timeZone: 'America/Sao_Paulo',
            }),
            registro: 'ajuste' as const,
            refNsr: null,
            aplicado: true,
            origem: 'solicitacao-inclusao',
            solicitacaoId: doc.id,
            nsr: selo.nsr,
            hash: selo.hash,
            hashAnterior: selo.hashAnterior,
            createdAt: new Date().toISOString(),
          });
        });
      } else if (doc.tipo === 'cancelar' && doc.batidaId) {
        // Cancelamento: NÃO altera a batida original (Portaria 671). Grava um
        // registro de CANCELAMENTO apontando para a original via refNsr; o
        // front desconsidera a original ao resolver o ledger.
        const batidaSnap = await this.timeRecords
          .where('id', '==', doc.batidaId)
          .get();
        if (!batidaSnap.empty) {
          const alvo = batidaSnap.docs[0].data() as {
            prefeituraId: string;
            name: string;
            cpf?: string | null;
            tipo: string;
            nsr?: number;
            id: string;
            timestampOriginal: string;
          };
          const cancelId = randomUUID();
          await db.runTransaction(async (tx) => {
            const selo = await selarRegistro(db, tx, {
              prefeituraId: alvo.prefeituraId,
              identificador: alvo.cpf?.replace(/\D/g, '') || alvo.name,
              tipo: alvo.tipo,
              timestampOriginal: alvo.timestampOriginal,
              registro: 'cancelamento',
              refNsr: alvo.nsr ?? null,
            });
            tx.set(this.timeRecords.doc(cancelId), {
              id: cancelId,
              prefeituraId: alvo.prefeituraId,
              name: alvo.name,
              cpf: alvo.cpf ?? null,
              tipo: alvo.tipo,
              timestampOriginal: alvo.timestampOriginal,
              registro: 'cancelamento' as const,
              refNsr: alvo.nsr ?? null,
              refId: alvo.id,
              aplicado: true,
              canceladoPorSolicitacao: doc.id,
              solicitacaoId: doc.id,
              nsr: selo.nsr,
              hash: selo.hash,
              hashAnterior: selo.hashAnterior,
              createdAt: new Date().toISOString(),
            });
          });
        }
      } else if (doc.tipo === 'abono' && doc.data) {
        // Aprovar abono cria um registro na coleção `abonos` — o front
        // consulta para classificar o dia como 'abonado'. Precisa do CPF para
        // casar com o funcionário: usa o da solicitação ou, se faltar, resolve
        // pelo cadastro de operadores (pelo nome). Se ainda assim não houver
        // CPF, AVISA (não falha calado).
        let cpf = (doc.cpf ?? '').replace(/\D/g, '');
        if (!cpf && doc.name?.trim()) {
          try {
            const opSnap = await db
              .collection('operadores')
              .where('prefeituraId', '==', doc.prefeituraId)
              .get();
            const alvo = doc.name.trim().toLowerCase();
            const op = opSnap.docs
              .map((d) => d.data() as { nome?: string; cpf?: string })
              .find((o) => (o.nome ?? '').trim().toLowerCase() === alvo);
            cpf = (op?.cpf ?? '').replace(/\D/g, '');
          } catch (lookupErr) {
            console.warn('Falha ao resolver CPF do operador:', lookupErr);
          }
        }
        if (cpf) {
          try {
            await this.abonos.criar({
              prefeituraId: doc.prefeituraId,
              funcionarioCpf: cpf,
              funcionarioNome: doc.name,
              data: doc.data,
              motivo: doc.observacao ?? null,
              solicitacaoId: doc.id,
            });
          } catch (abonoErr) {
            console.warn('Não foi possível criar abono:', abonoErr);
          }
        } else {
          console.warn(
            `Abono aprovado SEM criar registro: CPF não encontrado (solicitação ${doc.id}, "${doc.name}"). Cadastre o CPF do funcionário.`,
          );
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
