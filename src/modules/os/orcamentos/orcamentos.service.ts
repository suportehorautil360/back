import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { findPartnerOficinaPg } from '../../../common/prisma/partner-oficina.helper';
import {
  mapOrcamentoToListItem,
  toInputJson,
} from '../../../common/prisma/os-prisma.mapper';
import {
  publicLegacyId,
  resolveOrcamentoPg,
  resolveServiceOrderPg,
} from '../../../common/prisma/service-order-resolver';
import { NotificacoesService } from '../../notificacoes/notificacoes.service';
import {
  mergeLance,
  parseOficinasIds,
  parseOficinasResponderam,
  statusAposOrcamento,
} from '../helpers/lances-os.helper';
import type { CreateOrcamentoResult, LanceOs } from '../os.types';
import { CreateOrcamentoDto } from './dto/create-orcamento.dto';
import { UpdateOrcamentoDto } from './dto/update-orcamento.dto';
import {
  ordemPermiteEdicao,
  solicitacaoPermiteEdicaoOrcamento,
  solicitacaoPermiteNovoOrcamento,
} from './helpers/editar-orcamento.helper';
import { parseOrcamentoItemsFromDto } from './helpers/orcamento-items.helper';
import {
  mapOrdemToOrcamentoApi,
  type OrcamentoApiItem,
} from './helpers/orcamento-response.helper';

function texto(valor: unknown): string {
  return typeof valor === 'string' ? valor.trim() : '';
}

function fmtBRL(valor: number): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(valor);
}

@Injectable()
export class OrcamentosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notificacoes: NotificacoesService,
  ) {}

  async criar(dto: CreateOrcamentoDto): Promise<CreateOrcamentoResult> {
    const solicitacaoOsId = dto.solicitacaoOsId.trim();
    const oficinaId = dto.oficinaId.trim();
    const { itens, valorTotal } = parseOrcamentoItemsFromDto(dto.items);
    const prazoDias = dto.prazoDias ?? 7;
    const fotosComprovacao = dto.fotosComprovacao.map((url) => url.trim());

    const oficina = await findPartnerOficinaPg(this.prisma, oficinaId);
    const oficinaNome = oficina?.nome ?? oficinaId;

    try {
      const result = await this.prisma.$transaction(async (tx) => {
        const sol = await tx.serviceOrder.findFirst({
          where: {
            OR: [{ id: solicitacaoOsId }, { legacyId: solicitacaoOsId }],
          },
          include: { company: { select: { legacyId: true } } },
        });
        if (!sol) {
          throw new NotFoundException('Solicitação de OS não encontrada.');
        }

        const statusAtual = texto(sol.status) || 'aguardando_orcamento';
        if (!solicitacaoPermiteNovoOrcamento(statusAtual)) {
          throw new BadRequestException(
            'Esta solicitação não está aceitando novos orçamentos.',
          );
        }

        const oficinasIds = parseOficinasIds(sol.oficinasIds);
        if (!oficinasIds.includes(oficinaId)) {
          throw new BadRequestException(
            'Esta oficina não foi convidada para esta OS.',
          );
        }

        const responderam = parseOficinasResponderam(sol.oficinasResponderam);
        if (responderam.includes(oficinaId)) {
          throw new ConflictException(
            'Esta oficina já enviou orçamento para esta OS.',
          );
        }

        const dup = await tx.orcamento.findFirst({
          where: { serviceOrderId: sol.id, oficinaId },
        });
        if (dup) {
          throw new ConflictException(
            'Já existe orçamento desta oficina para esta solicitação.',
          );
        }

        const protocolo =
          texto(dto.protocol) || sol.protocolo || solicitacaoOsId;
        const prefeituraId = sol.company.legacyId ?? sol.companyId;
        const agora = new Date();

        const ordem = await tx.orcamento.create({
          data: {
            companyId: sol.companyId,
            serviceOrderId: sol.id,
            protocolo,
            oficinaId,
            oficinaNome,
            operadorNome: oficinaNome,
            equipamento: texto(sol.equipmentNome),
            defeito: texto(sol.relato),
            itens: toInputJson(itens),
            valorTotal,
            prazoDias,
            fotosComprovacao: toInputJson(fotosComprovacao),
            status: 'em_pregao',
          },
        });

        const lance: LanceOs = {
          oficinaId,
          valor: valorTotal,
          prazoDias,
          ordemServicoId: publicLegacyId(ordem),
          atualizadoEm: agora.toISOString(),
        };

        const lancesAtualizados = mergeLance(
          Array.isArray(sol.lances) ? (sol.lances as unknown as LanceOs[]) : [],
          lance,
        );
        const responderamAtualizados = [...responderam, oficinaId];
        const novoStatus = statusAposOrcamento(
          oficinasIds,
          responderamAtualizados,
        );

        await tx.serviceOrder.update({
          where: { id: sol.id },
          data: {
            oficinasResponderam: toInputJson(responderamAtualizados),
            lances: toInputJson(lancesAtualizados),
            status: novoStatus,
          },
        });

        return {
          id: publicLegacyId(ordem),
          protocol: protocolo,
          valorTotal,
          prazoDias,
          solicitacaoStatus: novoStatus,
          prefeituraId,
          oficinaNome,
        };
      });

      if (result.prefeituraId) {
        try {
          await this.notificacoes.create({
            destinatarioTipo: 'rh',
            destinatarioId: result.prefeituraId,
            prefeituraId: result.prefeituraId,
            tipo: 'info',
            titulo: `Novo orçamento: ${result.protocol}`,
            mensagem: `${result.oficinaNome} enviou orçamento de ${fmtBRL(
              result.valorTotal,
            )} (prazo: ${result.prazoDias} dia${
              result.prazoDias === 1 ? '' : 's'
            }).`,
            referenciaTipo: 'orcamento',
            referenciaId: result.id,
          });
        } catch (notifErr) {
          console.warn(
            'Não foi possível notificar a prefeitura sobre o orçamento:',
            notifErr,
          );
        }
      }

      return {
        id: result.id,
        protocol: result.protocol,
        valorTotal: result.valorTotal,
        prazoDias: result.prazoDias,
        solicitacaoStatus: result.solicitacaoStatus,
      };
    } catch (error) {
      if (
        error instanceof BadRequestException ||
        error instanceof NotFoundException ||
        error instanceof ConflictException
      ) {
        throw error;
      }
      console.error('Erro ao enviar orçamento:', error);
      throw new InternalServerErrorException(
        'Não foi possível enviar o orçamento.',
      );
    }
  }

  async atualizar(
    id: string,
    dto: UpdateOrcamentoDto,
  ): Promise<CreateOrcamentoResult> {
    const ordemId = id.trim();
    const oficinaId = dto.oficinaId.trim();

    if (!ordemId) {
      throw new BadRequestException('id inválido.');
    }
    if (!oficinaId) {
      throw new BadRequestException('oficinaId inválido.');
    }

    const { itens, valorTotal } = parseOrcamentoItemsFromDto(dto.items);
    const fotosComprovacao = dto.fotosComprovacao.map((url) => url.trim());

    try {
      const result = await this.prisma.$transaction(async (tx) => {
        const ordem = await tx.orcamento.findFirst({
          where: { OR: [{ id: ordemId }, { legacyId: ordemId }] },
        });
        if (!ordem) {
          throw new NotFoundException('Orçamento não encontrado.');
        }

        if (texto(ordem.oficinaId) !== oficinaId) {
          throw new BadRequestException(
            'Esta oficina não pode editar este orçamento.',
          );
        }

        if (!ordemPermiteEdicao(ordem.status)) {
          throw new BadRequestException(
            'Este orçamento não pode mais ser editado.',
          );
        }

        const sol = await tx.serviceOrder.findUnique({
          where: { id: ordem.serviceOrderId },
        });
        if (!sol) {
          throw new NotFoundException('Solicitação de OS não encontrada.');
        }

        const statusAtual = texto(sol.status) || 'aguardando_orcamento';
        if (!solicitacaoPermiteEdicaoOrcamento(statusAtual)) {
          throw new BadRequestException(
            'Esta solicitação não permite edição de orçamento.',
          );
        }

        const oficinasIds = parseOficinasIds(sol.oficinasIds);
        if (!oficinasIds.includes(oficinaId)) {
          throw new BadRequestException(
            'Esta oficina não foi convidada para esta OS.',
          );
        }

        const responderam = parseOficinasResponderam(sol.oficinasResponderam);
        if (!responderam.includes(oficinaId)) {
          throw new BadRequestException(
            'Esta oficina ainda não enviou orçamento para esta OS.',
          );
        }

        const prazoDias =
          dto.prazoDias ?? Math.max(1, Math.round(Number(ordem.prazoDias) || 7));
        const protocolo = ordem.protocolo || ordemId;
        const agora = new Date();

        await tx.orcamento.update({
          where: { id: ordem.id },
          data: {
            itens: toInputJson(itens),
            valorTotal,
            prazoDias,
            fotosComprovacao: toInputJson(fotosComprovacao),
          },
        });

        const lance: LanceOs = {
          oficinaId,
          valor: valorTotal,
          prazoDias,
          ordemServicoId: publicLegacyId(ordem),
          atualizadoEm: agora.toISOString(),
        };

        const lancesAtualizados = mergeLance(
          Array.isArray(sol.lances) ? (sol.lances as unknown as LanceOs[]) : [],
          lance,
        );

        await tx.serviceOrder.update({
          where: { id: sol.id },
          data: { lances: toInputJson(lancesAtualizados) },
        });

        return {
          id: publicLegacyId(ordem),
          protocol: protocolo,
          valorTotal,
          prazoDias,
          solicitacaoStatus: statusAtual,
        };
      });

      return result;
    } catch (error) {
      if (
        error instanceof BadRequestException ||
        error instanceof NotFoundException
      ) {
        throw error;
      }
      console.error('Erro ao atualizar orçamento:', error);
      throw new InternalServerErrorException(
        'Não foi possível atualizar o orçamento.',
      );
    }
  }

  async listarPorOficina(
    oficinaId: string,
  ): Promise<{ data: OrcamentoApiItem[]; message: string }> {
    const id = oficinaId.trim();
    if (!id) {
      throw new BadRequestException('oficinaId inválido.');
    }

    try {
      const rows = await this.prisma.orcamento.findMany({
        where: { oficinaId: id },
        include: {
          serviceOrder: { select: { id: true, legacyId: true, status: true } },
        },
        orderBy: { createdAt: 'desc' },
      });

      const data = rows.map((row) =>
        mapOrdemToOrcamentoApi(
          mapOrcamentoToListItem(row),
          texto(row.serviceOrder.status),
        ),
      );

      return {
        data,
        message: 'Orçamentos da oficina carregados com sucesso.',
      };
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      console.error('Erro ao listar orçamentos da oficina:', error);
      throw new InternalServerErrorException(
        'Não foi possível carregar os orçamentos da oficina.',
      );
    }
  }

  async obterPorId(
    id: string,
    oficinaId?: string,
  ): Promise<{ data: OrcamentoApiItem; message: string }> {
    const docId = id.trim();
    if (!docId) {
      throw new BadRequestException('id inválido.');
    }

    try {
      const ordem = await this.resolveOrdem(docId, oficinaId);
      if (!ordem) {
        throw new NotFoundException('Orçamento não encontrado.');
      }

      const status = ordem.serviceOrder.status;

      return {
        data: mapOrdemToOrcamentoApi(
          mapOrcamentoToListItem(ordem),
          texto(status),
        ),
        message: 'Orçamento encontrado.',
      };
    } catch (error) {
      if (
        error instanceof BadRequestException ||
        error instanceof NotFoundException
      ) {
        throw error;
      }
      console.error('Erro ao obter orçamento:', error);
      throw new InternalServerErrorException(
        'Não foi possível carregar o orçamento.',
      );
    }
  }

  private async resolveOrdem(id: string, oficinaId?: string) {
    const direct = await resolveOrcamentoPg(this.prisma, id);
    if (direct) return direct;

    const oficina = texto(oficinaId);
    if (oficina) {
      const sol = await resolveServiceOrderPg(this.prisma, id);
      if (sol) {
        return this.prisma.orcamento.findFirst({
          where: { serviceOrderId: sol.id, oficinaId: oficina },
          include: {
            serviceOrder: { select: { id: true, legacyId: true, status: true } },
          },
        });
      }
    }

    const solOnly = await resolveServiceOrderPg(this.prisma, id);
    if (!solOnly) return null;

    const rows = await this.prisma.orcamento.findMany({
      where: { serviceOrderId: solOnly.id },
      include: {
        serviceOrder: { select: { id: true, legacyId: true, status: true } },
      },
      take: oficina ? 1 : 20,
    });

    if (!rows.length) return null;

    if (oficina && rows.length > 1) {
      return (
        rows.find((entry) => texto(entry.oficinaId) === oficina) ?? rows[0]
      );
    }

    return rows[0];
  }
}
