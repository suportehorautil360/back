import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { FirebaseService } from '../../config/firebase.service';
import { mapChecklistDevolucaoFromFirestore } from '../checklist-devolucao/helpers/checklist-devolucao.mapper';
import type { ChecklistDevolucaoDoc } from '../checklist-devolucao/checklist-devolucao.types';
import { derivarOcorrenciasOs } from './helpers/derivar-ocorrencias.helper';
import {
  mapOcorrenciaParaLista,
  type OcorrenciaResumoOs,
} from './ocorrencias.types';

function texto(valor: unknown): string {
  return typeof valor === 'string' ? valor.trim() : '';
}

@Injectable()
export class OcorrenciasService {
  constructor(private readonly firebaseService: FirebaseService) {}

  private get solicitacoesCollection() {
    return this.firebaseService.getFirestore().collection('solicitacoesOS');
  }

  private get ordensCollection() {
    return this.firebaseService.getFirestore().collection('ordensServico');
  }

  private get chdCollection() {
    return this.firebaseService.getFirestore().collection('checklistsDevolucao');
  }

  private async buscarChdsHistorico(
    solicitacaoOsId: string,
    protocolo: string,
  ): Promise<ChecklistDevolucaoDoc[]> {
    const map = new Map<string, ChecklistDevolucaoDoc>();

    const bySol = await this.chdCollection
      .where('solicitacaoOsId', '==', solicitacaoOsId)
      .get();

    for (const doc of bySol.docs) {
      map.set(
        doc.id,
        mapChecklistDevolucaoFromFirestore(
          doc.id,
          doc.data() as Record<string, unknown>,
        ),
      );
    }

    const proto = texto(protocolo);
    if (proto) {
      const byProto = await this.chdCollection
        .where('identification.os', '==', proto)
        .get();
      for (const doc of byProto.docs) {
        if (map.has(doc.id)) continue;
        map.set(
          doc.id,
          mapChecklistDevolucaoFromFirestore(
            doc.id,
            doc.data() as Record<string, unknown>,
          ),
        );
      }
    }

    return [...map.values()].sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt),
    );
  }

  async listarPorSolicitacao(solicitacaoOsId: string) {
    const solId = solicitacaoOsId.trim();
    if (!solId) throw new BadRequestException('solicitacaoOsId inválido.');

    try {
      const solSnap = await this.solicitacoesCollection.doc(solId).get();
      if (!solSnap.exists) {
        throw new NotFoundException('Solicitação de O.S. não encontrada.');
      }

      const sol = solSnap.data() as Record<string, unknown>;
      const protocolo = texto(sol.protocolo) || texto(sol.protocol);

      const [ordSnap, chds] = await Promise.all([
        this.ordensCollection.where('solicitacaoOsId', '==', solId).get(),
        this.buscarChdsHistorico(solId, protocolo),
      ]);

      const ordens = ordSnap.docs.map((doc) => ({
        id: doc.id,
        data: doc.data() as Record<string, unknown>,
      }));

      const linhas = derivarOcorrenciasOs({
        solicitacaoId: solId,
        solicitacao: sol,
        ordens,
        chds,
      });

      const data = linhas.map(mapOcorrenciaParaLista);
      const resumo: OcorrenciaResumoOs = { total: data.length };

      return {
        resumo,
        data,
        message:
          data.length > 0
            ? 'Histórico de ocorrências carregado.'
            : 'Nenhuma ocorrência registrada para esta O.S.',
      };
    } catch (error) {
      if (
        error instanceof BadRequestException ||
        error instanceof NotFoundException
      ) {
        throw error;
      }
      console.error('Erro ao listar ocorrências por solicitação:', error);
      throw new InternalServerErrorException(
        'Não foi possível carregar o histórico desta O.S.',
      );
    }
  }
}
