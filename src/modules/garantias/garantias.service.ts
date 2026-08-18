import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  garantiaDocToPrismaCreate,
  mapGarantiaFromRow,
} from '../../common/prisma/garantia-prisma.mapper';
import { resolverCompanyId } from '../../common/prisma/company-resolver';
import { loadServiceOrderForChdPg } from '../../common/prisma/os-solicitacao.helper';
import { findPartnerOficinaPg } from '../../common/prisma/partner-oficina.helper';
import {
  buscarChdsPorEquipamentoPg,
  buscarChdsPorSolicitacaoPg,
} from '../checklist-devolucao/helpers/chd-por-solicitacao.helper';
import type { ChecklistDevolucaoDoc } from '../checklist-devolucao/checklist-devolucao.types';
import type { GarantiaDoc, GarantiaListItem } from './garantias.types';
import { gerarGarantiasDeChecklistDevolucao } from './helpers/gerar-garantias-de-chd.helper';
import {
  aplicarFiltrosGarantia,
  mesclarLinhasGarantia,
  montarResumoGarantia,
  parseHorimetroQuery,
  type FiltrosGarantiaQuery,
} from './helpers/garantias-query.helper';
import { mapGarantiaParaLista } from './helpers/garantias.mapper';

function texto(valor: unknown): string {
  return typeof valor === 'string' ? valor.trim() : '';
}

@Injectable()
export class GarantiasService {
  constructor(private readonly prisma: PrismaService) {}

  async gerarDeChecklistDevolucao(
    chd: ChecklistDevolucaoDoc,
    ctx: {
      prefeituraId: string;
      equipamentoId: string;
      equipamento: string;
      fornecedor: string;
      horimetroAtual?: number | null;
    },
  ): Promise<GarantiaDoc[]> {
    const registros = gerarGarantiasDeChecklistDevolucao(chd, ctx);
    if (!registros.length) return [];

    const companyId = await resolverCompanyId(this.prisma, ctx.prefeituraId);
    if (!companyId) return [];

    await this.prisma.$transaction(
      registros.map((registro) =>
        this.prisma.garantia.create({
          data: garantiaDocToPrismaCreate(registro, companyId),
        }),
      ),
    );

    return registros;
  }

  async listarPorSolicitacao(
    solicitacaoOsId: string,
    query: FiltrosGarantiaQuery,
  ) {
    const solId = solicitacaoOsId.trim();
    if (!solId) throw new BadRequestException('solicitacaoOsId inválido.');

    const horimetroAtual = parseHorimetroQuery(query.horimetroAtual);

    try {
      const sol = await loadServiceOrderForChdPg(this.prisma, solId);
      if (!sol) {
        throw new NotFoundException('Solicitação de O.S. não encontrada.');
      }

      const equipamentoId =
        sol.equipment?.legacyId ?? sol.equipmentId ?? '';
      const equipamento = texto(sol.equipmentNome);
      const prefeituraId = sol.company.legacyId ?? sol.companyId;
      const protocolo = texto(sol.protocolo);

      const chds = await buscarChdsPorSolicitacaoPg(
        this.prisma,
        solId,
        protocolo,
      );
      const linhasChd = await this.derivarLinhasDeChds(chds, {
        prefeituraId,
        equipamentoId,
        equipamento,
        horimetroAtual,
      });

      const persistidas = equipamentoId
        ? await this.carregarPersistidasPorEquipamento(equipamentoId)
        : [];
      const persistidasOs = persistidas
        .filter((doc) => doc.solicitacaoOsId === solId)
        .map((doc) => mapGarantiaParaLista(doc, horimetroAtual));

      const todas = mesclarLinhasGarantia(persistidasOs, linhasChd);
      const linhas = aplicarFiltrosGarantia(todas, query);

      return {
        resumo: montarResumoGarantia({
          equipamentoId: equipamentoId || solId,
          equipamento: equipamento || '—',
          horimetroAtual,
          linhas: todas,
        }),
        data: linhas,
        chdsEncontrados: chds.length,
        message:
          chds.length > 0
            ? 'Garantias derivadas do checklist de devolução (CHD) desta O.S.'
            : 'Nenhum CHD encontrado para esta O.S. — aguardando devolução da oficina.',
      };
    } catch (error) {
      if (
        error instanceof BadRequestException ||
        error instanceof NotFoundException
      ) {
        throw error;
      }
      console.error('Erro ao listar garantias por solicitação:', error);
      throw new InternalServerErrorException(
        'Não foi possível carregar as garantias desta O.S.',
      );
    }
  }

  async listarPorEquipamento(
    equipamentoId: string,
    query: FiltrosGarantiaQuery,
  ) {
    const id = equipamentoId.trim();
    if (!id) throw new BadRequestException('equipamentoId inválido.');

    const horimetroAtual = parseHorimetroQuery(query.horimetroAtual);

    try {
      const persistidas = await this.carregarPersistidasPorEquipamento(id);
      const linhasPersistidas = persistidas.map((doc) =>
        mapGarantiaParaLista(doc, horimetroAtual),
      );

      const chds = await buscarChdsPorEquipamentoPg(this.prisma, id);
      const linhasChd = await this.derivarLinhasDeChds(chds, {
        prefeituraId: persistidas[0]?.prefeituraId ?? chds[0]?.prefeituraId ?? '',
        equipamentoId: id,
        equipamento:
          persistidas[0]?.equipamento ??
          chds[0]?.identification.brandModel ??
          '—',
        horimetroAtual,
      });

      const todas = mesclarLinhasGarantia(linhasPersistidas, linhasChd);
      const linhas = aplicarFiltrosGarantia(todas, query);
      const equipamentoNome =
        persistidas[0]?.equipamento ??
        chds[0]?.identification.brandModel ??
        '—';

      return {
        resumo: montarResumoGarantia({
          equipamentoId: id,
          equipamento: equipamentoNome,
          horimetroAtual,
          linhas: todas,
        }),
        data: linhas,
        message: 'Histórico de garantia carregado com sucesso.',
      };
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      console.error('Erro ao listar garantias:', error);
      throw new InternalServerErrorException(
        'Não foi possível carregar o histórico de garantia.',
      );
    }
  }

  private async carregarPersistidasPorEquipamento(
    equipamentoId: string,
  ): Promise<GarantiaDoc[]> {
    const rows = await this.prisma.garantia.findMany({
      where: { equipamentoId },
      include: { company: { select: { legacyId: true } } },
      orderBy: { dataExecucao: 'desc' },
    });

    return rows.map(mapGarantiaFromRow);
  }

  private async derivarLinhasDeChds(
    chds: ChecklistDevolucaoDoc[],
    ctx: {
      prefeituraId: string;
      equipamentoId: string;
      equipamento: string;
      horimetroAtual: number | null;
    },
  ): Promise<GarantiaListItem[]> {
    const linhas: GarantiaListItem[] = [];

    for (const chd of chds) {
      const fornecedor = await this.resolveFornecedor(chd.oficinaId);
      const docs = gerarGarantiasDeChecklistDevolucao(chd, {
        prefeituraId: ctx.prefeituraId || texto(chd.prefeituraId),
        equipamentoId: ctx.equipamentoId,
        equipamento: ctx.equipamento || chd.identification.brandModel,
        fornecedor,
        horimetroAtual: ctx.horimetroAtual,
      });

      docs.forEach((doc, index) => {
        const comId = {
          ...doc,
          id: `${chd.id}-${doc.tipo}-${index}`,
        };
        linhas.push(mapGarantiaParaLista(comId, ctx.horimetroAtual));
      });
    }

    return linhas;
  }

  private async resolveFornecedor(oficinaId: string): Promise<string> {
    const id = texto(oficinaId);
    if (!id) return '—';

    const oficina = await findPartnerOficinaPg(this.prisma, id);
    return oficina?.nome ?? id;
  }
}
