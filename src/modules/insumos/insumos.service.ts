import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { FirebaseService } from '../../config/firebase.service';
import {
  extrairItensOrcamentoDoc,
  selecionarOrdensParaInsumos,
} from '../os/orcamentos/helpers/extrair-itens-orcamento.helper';
import { derivarInsumosDeOrcamentoItem } from './helpers/derivar-insumos.helper';
import {
  mapInsumoParaLista,
  montarResumoInsumos,
  type InsumoDoc,
} from './insumos.types';

@Injectable()
export class InsumosService {
  constructor(private readonly firebaseService: FirebaseService) {}

  private get solicitacoesCollection() {
    return this.firebaseService.getFirestore().collection('solicitacoesOS');
  }

  private get ordensCollection() {
    return this.firebaseService.getFirestore().collection('ordensServico');
  }

  async listarPorSolicitacao(solicitacaoOsId: string) {
    const solId = solicitacaoOsId.trim();
    if (!solId) throw new BadRequestException('solicitacaoOsId inválido.');

    try {
      const solSnap = await this.solicitacoesCollection.doc(solId).get();
      if (!solSnap.exists) {
        throw new NotFoundException('Solicitação de O.S. não encontrada.');
      }

      const ordSnap = await this.ordensCollection
        .where('solicitacaoOsId', '==', solId)
        .get();

      const sol = solSnap.data() as Record<string, unknown>;
      const ordensDocs = selecionarOrdensParaInsumos(ordSnap.docs, sol);

      const linhas: InsumoDoc[] = [];
      for (const doc of ordensDocs) {
        const data = doc.data() as Record<string, unknown>;
        const rawItens = extrairItensOrcamentoDoc(data);

        rawItens.forEach((rawItem, index) => {
          const insumo = derivarInsumosDeOrcamentoItem(
            doc.id,
            rawItem,
            index,
          );
          if (insumo) linhas.push(insumo);
        });
      }

      const data = linhas.map(mapInsumoParaLista);

      return {
        resumo: montarResumoInsumos(linhas, ordensDocs.length),
        data,
        message:
          linhas.length > 0
            ? 'Insumos carregados a partir do orçamento da O.S.'
            : ordensDocs.length > 0
              ? 'Orçamento encontrado, mas sem itens de peça/material.'
              : 'Nenhum orçamento encontrado para esta O.S.',
      };
    } catch (error) {
      if (
        error instanceof BadRequestException ||
        error instanceof NotFoundException
      ) {
        throw error;
      }
      console.error('Erro ao listar insumos por solicitação:', error);
      throw new InternalServerErrorException(
        'Não foi possível carregar os insumos desta O.S.',
      );
    }
  }
}
