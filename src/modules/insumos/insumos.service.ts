import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  publicLegacyId,
  serviceOrderWhere,
} from '../../common/prisma/service-order-resolver';
import {
  extrairItensOrcamentoPrisma,
  selecionarOrdensParaInsumosPg,
} from '../os/orcamentos/helpers/extrair-itens-orcamento.helper';
import { derivarInsumosDeOrcamentoItem } from './helpers/derivar-insumos.helper';
import {
  mapInsumoParaLista,
  montarResumoInsumos,
  type InsumoDoc,
} from './insumos.types';

@Injectable()
export class InsumosService {
  constructor(private readonly prisma: PrismaService) {}

  async listarPorSolicitacao(solicitacaoOsId: string) {
    const solId = solicitacaoOsId.trim();
    if (!solId) throw new BadRequestException('solicitacaoOsId inválido.');

    try {
      const sol = await this.prisma.serviceOrder.findFirst({
        where: serviceOrderWhere(solId),
        select: { id: true, ordemServicoAprovadaId: true },
      });
      if (!sol) {
        throw new NotFoundException('Solicitação de O.S. não encontrada.');
      }

      const ordens = await this.prisma.orcamento.findMany({
        where: { serviceOrderId: sol.id },
        select: { id: true, legacyId: true, status: true, itens: true },
      });

      const ordensSelecionadas = selecionarOrdensParaInsumosPg(ordens, sol);

      const linhas: InsumoDoc[] = [];
      for (const ordem of ordensSelecionadas) {
        const ordemPublicId = publicLegacyId(ordem);
        const rawItens = extrairItensOrcamentoPrisma(ordem.itens);

        rawItens.forEach((rawItem, index) => {
          const insumo = derivarInsumosDeOrcamentoItem(
            ordemPublicId,
            rawItem,
            index,
          );
          if (insumo) linhas.push(insumo);
        });
      }

      const data = linhas.map(mapInsumoParaLista);

      return {
        resumo: montarResumoInsumos(linhas, ordensSelecionadas.length),
        data,
        message:
          linhas.length > 0
            ? 'Insumos carregados a partir do orçamento da O.S.'
            : ordensSelecionadas.length > 0
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
