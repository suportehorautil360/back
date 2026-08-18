import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { resolverCompanyId } from '../../../common/prisma/company-resolver';
import { fetchEquipmentMapPg, resolveEquipmentByIdPg } from '../../../common/prisma/equipment-resolver';
import { nextProtocoloOsPg } from '../../../common/prisma/gerar-protocolo-os-prisma.helper';
import {
  mapOrcamentoToListItem,
  mapServiceOrderToListItem,
  serviceOrderToFirestoreShape,
  toInputJson,
} from '../../../common/prisma/os-prisma.mapper';
import { listarOficinasAtivasPg, partnerPublicId as publicLegacyId } from '../../../common/prisma/partner-oficina.helper';
import {
  publicLegacyId as publicId,
  serviceOrderWhere,
} from '../../../common/prisma/service-order-resolver';
import {
  parseDateEnd,
  parseDateStart,
} from '../../movimentacoes/shared/date.helper';
import {
  enrichSolicitacoesWithEquipamento,
  formatEquipamentoHorimetro,
} from '../helpers/enrich-solicitacoes-equipamento.helper';
import {
  normalizeOsServiceType,
  osServiceTypeLabel,
  tipoOsLegacyCode,
} from '../helpers/os-service-type.helper';
import { resolveSegmentoEquipamento, resolveLinhaEquipamento } from '../helpers/segmento-equipamento.helper';
import { filtrarOficinasElegiveis } from '../helpers/selecionar-oficinas.helper';
import {
  ordemElegivelParaAprovacao,
  ordemElegivelParaRecusa,
  solicitacaoPermiteAprovacao,
} from '../helpers/aprovar-orcamento.helper';
import type {
  AprovarSolicitacaoResult,
  CreateSolicitacaoResult,
  OrdemOrcamentoListItem,
  SolicitacaoComOrcamentosListItem,
  SolicitacaoOsListItem,
} from '../os.types';
import { shouldIncludeSolicitacaoForOficina } from '../helpers/solicitacoes-oficina.helper';
import { CreateSolicitacaoDto } from './dto/create-solicitacao.dto';
import { ListSolicitacoesOficinaQueryDto } from './dto/list-solicitacoes-oficina-query.dto';
import { ListSolicitacoesQueryDto } from './dto/list-solicitacoes-query.dto';

function texto(valor: unknown): string {
  return typeof valor === 'string' ? valor.trim() : '';
}

function resolveNomeEquipamento(raw: Record<string, unknown>): string {
  return (
    texto(raw.descricao) ||
    texto(raw.label) ||
    `${texto(raw.marca)} ${texto(raw.modelo)}`.trim() ||
    '—'
  );
}

const serviceOrderInclude = {
  company: { select: { legacyId: true } },
  equipment: { select: { id: true, legacyId: true } },
} as const;

@Injectable()
export class SolicitacoesService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateSolicitacaoDto): Promise<CreateSolicitacaoResult> {
    const prefeituraId = dto.prefeituraId.trim();
    const equipmentId = dto.equipmentId.trim();
    const operator = dto.operator.trim();
    const report = dto.report.trim();

    const companyId = await resolverCompanyId(this.prisma, prefeituraId);
    if (!companyId) {
      throw new BadRequestException('prefeituraId inválido.');
    }

    const equipamentoResolvido = await resolveEquipmentByIdPg(
      this.prisma,
      prefeituraId,
      equipmentId,
    );
    const equipamento = equipamentoResolvido.raw;
    const linha = resolveLinhaEquipamento(equipamento);
    if (!linha) {
      throw new BadRequestException(
        'Equipment has no line/type configured for workshop routing.',
      );
    }

    const segmento = resolveSegmentoEquipamento(equipamento);
    const oficinas = await listarOficinasAtivasPg(
      this.prisma,
      companyId,
      prefeituraId,
    );
    if (oficinas.length === 0) {
      throw new UnprocessableEntityException(
        'Nenhuma oficina credenciada e ativa para este município. ' +
          'Credencie uma oficina via POST /clientes/:prefeituraId/parceiros/:parceiroId/credenciar',
      );
    }

    const elegiveis = filtrarOficinasElegiveis(
      oficinas,
      linha,
      segmento || undefined,
    );
    if (elegiveis.length === 0) {
      const detalheSegmento = segmento
        ? `segmento "${segmento}" e linha "${linha}"`
        : `linha "${linha}"`;
      throw new UnprocessableEntityException(
        `Nenhuma oficina credenciada atende ${detalheSegmento}. ` +
          'Revise segmentos de atuação no cadastro da oficina ou a linha do equipamento.',
      );
    }

    const convidadas = elegiveis;
    const serviceType = normalizeOsServiceType(dto.serviceType ?? dto.type);

    try {
      const protocolo = await nextProtocoloOsPg(this.prisma, companyId);
      const horimetro =
        formatEquipamentoHorimetro(equipamento) || undefined;

      const row = await this.prisma.serviceOrder.create({
        data: {
          companyId,
          protocolo,
          tipoOs: tipoOsLegacyCode(serviceType),
          serviceType,
          equipmentId: equipamentoResolvido.equipmentUuid,
          equipmentNome: resolveNomeEquipamento(equipamento),
          linha,
          ...(segmento ? { segmento } : {}),
          horimetro,
          operadorNome: operator,
          relato: report,
          oficinasIds: toInputJson(convidadas.map((o) => o.id)),
          oficinasNomes: toInputJson(convidadas.map((o) => o.nome)),
          oficinasResponderam: toInputJson([]),
          lances: toInputJson([]),
          status: 'aguardando_orcamento',
          ...(dto.scheduledDate?.trim()
            ? { dataAgendamento: new Date(`${dto.scheduledDate.trim()}T12:00:00`) }
            : {}),
        },
        include: serviceOrderInclude,
      });

      return {
        id: publicLegacyId(row),
        protocol: protocolo,
        serviceType,
        serviceTypeLabel: osServiceTypeLabel(serviceType),
        invitedWorkshops: convidadas.map((o) => ({ id: o.id, name: o.nome })),
        status: 'aguardando_orcamento',
      };
    } catch (error) {
      if (
        error instanceof BadRequestException ||
        error instanceof NotFoundException ||
        error instanceof UnprocessableEntityException
      ) {
        throw error;
      }
      console.error('Erro ao criar solicitacao OS:', error);
      throw new InternalServerErrorException(
        'Could not create service order request.',
      );
    }
  }

  async listByOficina(
    oficinaId: string,
    query: ListSolicitacoesOficinaQueryDto,
  ): Promise<{ data: SolicitacaoOsListItem[]; message: string }> {
    const id = oficinaId.trim();
    if (!id) {
      throw new BadRequestException('oficinaId inválido.');
    }

    const statusFiltro = query.status?.trim();

    try {
      const rows = await this.prisma.serviceOrder.findMany({
        where: {
          oficinasIds: { array_contains: id },
          ...(statusFiltro && statusFiltro !== 'todos'
            ? { status: statusFiltro }
            : {}),
        },
        include: serviceOrderInclude,
      });

      let items = rows
        .filter((row) => {
          const data = serviceOrderToFirestoreShape(row);
          const pref = texto(query.prefeituraId);
          if (pref && texto(data.prefeituraId) !== pref) return false;

          if (
            statusFiltro &&
            ['aguardando_orcamento', 'recebida', 'nova'].includes(
              statusFiltro.toLowerCase(),
            )
          ) {
            return shouldIncludeSolicitacaoForOficina(
              data,
              id,
              query.prefeituraId,
              statusFiltro,
            );
          }

          return true;
        })
        .map((row) => mapServiceOrderToListItem(row, id));

      if (query.startDate) {
        const startMs = parseDateStart(query.startDate, 'startDate').getTime();
        items = items.filter((item) => {
          const ms = new Date(item.createdAt).getTime();
          return !Number.isNaN(ms) && ms >= startMs;
        });
      }

      if (query.endDate) {
        const endMs = parseDateEnd(query.endDate, 'endDate').getTime();
        items = items.filter((item) => {
          const ms = new Date(item.createdAt).getTime();
          return !Number.isNaN(ms) && ms <= endMs;
        });
      }

      items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      items = await this.enrichWithEquipamentoChassis(items);

      return {
        data: items,
        message: 'Service order requests for workshop loaded successfully.',
      };
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      console.error('Erro ao listar solicitacoes OS da oficina:', error);
      throw new InternalServerErrorException(
        'Could not load service order requests for the workshop.',
      );
    }
  }

  async aprovar(
    solicitacaoId: string,
    ordemServicoId: string,
  ): Promise<AprovarSolicitacaoResult> {
    const solId = solicitacaoId.trim();
    const ordemId = ordemServicoId.trim();
    if (!solId || !ordemId) {
      throw new BadRequestException('solicitacaoId e ordemServicoId são obrigatórios.');
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        const sol = await tx.serviceOrder.findFirst({
          where: serviceOrderWhere(solId),
        });
        if (!sol) {
          throw new NotFoundException('Solicitação de OS não encontrada.');
        }

        const ordem = await tx.orcamento.findFirst({
          where: {
            OR: [{ id: ordemId }, { legacyId: ordemId }],
            serviceOrderId: sol.id,
          },
        });
        if (!ordem) {
          throw new NotFoundException('Orçamento não encontrado.');
        }

        if (!solicitacaoPermiteAprovacao(sol.status)) {
          throw new ConflictException(
            'Esta O.S. já foi finalizada e não pode ser aprovada novamente.',
          );
        }

        if (!ordemElegivelParaAprovacao(ordem.status)) {
          throw new UnprocessableEntityException(
            'Este orçamento não está elegível para aprovação.',
          );
        }

        const agora = new Date();
        const ordemPublicId = publicId(ordem);

        await tx.orcamento.update({
          where: { id: ordem.id },
          data: { status: 'aprovado' },
        });

        const outras = await tx.orcamento.findMany({
          where: {
            serviceOrderId: sol.id,
            id: { not: ordem.id },
          },
        });

        for (const outra of outras) {
          if (ordemElegivelParaRecusa(outra.status)) {
            await tx.orcamento.update({
              where: { id: outra.id },
              data: { status: 'recusado' },
            });
          }
        }

        await tx.serviceOrder.update({
          where: { id: sol.id },
          data: {
            status: 'aprovado',
            aprovadoEm: agora,
            ordemServicoAprovadaId: ordemPublicId,
            oficinaVencedoraId: texto(ordem.oficinaId),
            valorAprovado: ordem.valorTotal,
          },
        });

        return {
          solicitacaoId: publicId(sol),
          approvedOrdemId: ordemPublicId,
          status: 'aprovado',
        };
      });
    } catch (error) {
      if (
        error instanceof BadRequestException ||
        error instanceof NotFoundException ||
        error instanceof ConflictException ||
        error instanceof UnprocessableEntityException
      ) {
        throw error;
      }
      console.error('Erro ao aprovar orçamento:', error);
      throw new InternalServerErrorException(
        'Não foi possível aprovar o orçamento.',
      );
    }
  }

  async listComOrcamentosByPrefeitura(
    prefeituraId: string,
    query: ListSolicitacoesQueryDto,
  ): Promise<{ data: SolicitacaoComOrcamentosListItem[]; message: string }> {
    try {
      const { data: solicitacoes } = await this.listByPrefeitura(
        prefeituraId,
        query,
      );

      const companyId = await resolverCompanyId(this.prisma, prefeituraId);
      if (!companyId) {
        throw new BadRequestException('prefeituraId inválido.');
      }

      const ordens = await this.prisma.orcamento.findMany({
        where: { companyId },
        include: {
          serviceOrder: { select: { id: true, legacyId: true } },
        },
      });

      const ordensPorSolicitacao = new Map<string, OrdemOrcamentoListItem[]>();

      for (const row of ordens) {
        const ordem = mapOrcamentoToListItem(row);
        const solPublicId = ordem.solicitacaoOsId;
        if (!solPublicId) continue;

        const lista = ordensPorSolicitacao.get(solPublicId) ?? [];
        lista.push(ordem);
        ordensPorSolicitacao.set(solPublicId, lista);
      }

      for (const [solId, lista] of ordensPorSolicitacao) {
        lista.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
        ordensPorSolicitacao.set(solId, lista);
      }

      const data = solicitacoes.map((sol) => {
        const quotes = ordensPorSolicitacao.get(sol.id) ?? [];
        return {
          ...sol,
          quotes,
          orcamentos: quotes,
          quotesReceived: quotes.length,
          invitedCount: sol.oficinasIds.length,
        };
      });

      return {
        data,
        message: 'Service order requests with quotes loaded successfully.',
      };
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      console.error('Erro ao listar solicitacoes com orcamentos:', error);
      throw new InternalServerErrorException(
        'Could not load service order requests with quotes.',
      );
    }
  }

  async listByPrefeitura(
    prefeituraId: string,
    query: ListSolicitacoesQueryDto,
  ): Promise<{ data: SolicitacaoOsListItem[]; message: string }> {
    const companyId = await resolverCompanyId(this.prisma, prefeituraId);
    if (!companyId) {
      throw new BadRequestException('prefeituraId inválido.');
    }

    try {
      const rows = await this.prisma.serviceOrder.findMany({
        where: { companyId },
        include: serviceOrderInclude,
      });

      let items = rows.map((row) => mapServiceOrderToListItem(row));

      if (query.status && query.status !== 'todos') {
        items = items.filter((item) => item.status === query.status);
      }

      if (query.startDate) {
        const startMs = parseDateStart(query.startDate, 'startDate').getTime();
        items = items.filter((item) => {
          const ms = new Date(item.createdAt).getTime();
          return !Number.isNaN(ms) && ms >= startMs;
        });
      }

      if (query.endDate) {
        const endMs = parseDateEnd(query.endDate, 'endDate').getTime();
        items = items.filter((item) => {
          const ms = new Date(item.createdAt).getTime();
          return !Number.isNaN(ms) && ms <= endMs;
        });
      }

      items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      items = await this.enrichWithEquipamentoChassis(items);

      return {
        data: items,
        message: 'Service order requests loaded successfully.',
      };
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      console.error('Erro ao listar solicitacoes OS:', error);
      throw new InternalServerErrorException(
        'Could not load service order requests.',
      );
    }
  }

  private async enrichWithEquipamentoChassis(
    items: SolicitacaoOsListItem[],
  ): Promise<SolicitacaoOsListItem[]> {
    const equipmentIds = items
      .map((item) => item.equipmentId || item.equipamentoId)
      .filter(Boolean);

    if (!equipmentIds.length) return items;

    const equipmentMap = await fetchEquipmentMapPg(this.prisma, equipmentIds);
    return enrichSolicitacoesWithEquipamento(items, equipmentMap);
  }
}
