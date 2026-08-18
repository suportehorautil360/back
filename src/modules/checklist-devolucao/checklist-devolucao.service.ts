import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import {
  checklistDevolucaoPatchToPrisma,
  checklistDevolucaoToPrismaCreate,
  mapChecklistDevolucaoFromRow,
} from '../../common/prisma/checklist-devolucao-prisma.mapper';
import { companyWhere, resolverCompanyId } from '../../common/prisma/company-resolver';
import {
  assertOficinaTemOrcamentoNaSolicitacaoPg,
  listServiceOrderPublicIdsPg,
  loadServiceOrderForChdPg,
  resolveCompanyIdForChdPg,
  resolveSolicitacaoIdPorProtocoloPg,
} from '../../common/prisma/os-solicitacao.helper';
import { findPartnerOficinaPg } from '../../common/prisma/partner-oficina.helper';
import {
  resolveChecklistDevolucaoPg,
} from '../../common/prisma/chd-resolver';
import { serviceOrderWhere } from '../../common/prisma/service-order-resolver';
import { EquipamentosService } from '../equipamentos/equipamentos.service';
import { GarantiasService } from '../garantias/garantias.service';
import { parseHorimetro } from '../garantias/helpers/parse-horimetro.helper';
import type { ChecklistDevolucaoDoc } from './checklist-devolucao.types';
import { ConferirChecklistDevolucaoDto } from './dto/conferir-checklist-devolucao.dto';
import {
  buildChecklistDevolucaoDoc,
  mapGeneralStateItems,
} from './helpers/checklist-devolucao.mapper';
import { nextNumeroDevolucaoPg } from './helpers/gerar-numero-devolucao.helper';
import {
  countPartsHintInRawBody,
  extractPartsFromPatchBody,
  normalizeCreateChecklistDevolucaoDto,
} from './helpers/normalize-chd-payload.helper';
import { chdBadRequest } from './helpers/chd-response.helper';
import { parseChdRequestBody } from './helpers/parse-chd-body.helper';
import {
  mergeIdentificationOs,
  resolveOsProtocoloPg,
} from './helpers/resolve-os-protocolo.helper';

function texto(valor: unknown): string {
  return typeof valor === 'string' ? valor.trim() : '';
}

@Injectable()
export class ChecklistDevolucaoService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly garantiasService: GarantiasService,
    private readonly equipamentosService: EquipamentosService,
  ) {}

  private async equipamentoIdDaSolicitacao(
    solicitacaoOsId: string | null,
  ): Promise<string | null> {
    const solId = texto(solicitacaoOsId);
    if (!solId) return null;

    const sol = await loadServiceOrderForChdPg(this.prisma, solId);
    if (!sol) return null;

    return sol.equipment?.legacyId ?? sol.equipmentId ?? null;
  }

  async criar(body: unknown): Promise<ChecklistDevolucaoDoc> {
    const dto = parseChdRequestBody(body);
    const oficinaId = texto(dto.oficinaId).trim();
    if (!oficinaId) {
      throw chdBadRequest('oficinaId é obrigatório.', {
        oficinaId: { message: 'Informe oficinaId no body' },
      });
    }

    const osProtocolo = await resolveOsProtocoloPg(dto, this.prisma);
    if (!osProtocolo) {
      throw chdBadRequest(
        'Informe o protocolo da O.S. em identification.os, protocolo/os no body, ou solicitacaoOsId de uma OS existente.',
        {
          'identification.os': {
            message:
              'Protocolo da O.S. ausente — use identification.os, protocolo, os ou solicitacaoOsId',
          },
        },
      );
    }

    let dtoNormalizado = normalizeCreateChecklistDevolucaoDto(
      mergeIdentificationOs(dto, osProtocolo),
    );

    if (!dtoNormalizado.parts.items.length) {
      const fallbackParts = extractPartsFromPatchBody(
        (body as Record<string, unknown>)?.parts ??
          (body as Record<string, unknown>)?.pecas,
      );
      if (fallbackParts.length > 0) {
        dtoNormalizado = {
          ...dtoNormalizado,
          parts: { items: fallbackParts },
        };
      }
    }

    const partsHint = countPartsHintInRawBody(body);
    if (partsHint > 0 && !dtoNormalizado.parts.items.length) {
      throw chdBadRequest(
        'O payload enviou peças em parts.items, mas o servidor não conseguiu interpretá-las.',
        {
          'parts.items': {
            count: partsHint,
            message:
              'Verifique Content-Type: application/json ou envie o JSON no campo data (multipart)',
          },
        },
      );
    }

    if (!texto(dtoNormalizado.identification?.date)) {
      throw chdBadRequest('identification.date é obrigatório.', {
        'identification.date': {
          message: 'Informe identification.date (ex.: 2026-06-23)',
        },
      });
    }

    const solicitacaoOsId =
      texto(dtoNormalizado.solicitacaoOsId) ||
      texto(dto.solicitacaoOsId) ||
      (await resolveSolicitacaoIdPorProtocoloPg(this.prisma, osProtocolo));

    await assertOficinaTemOrcamentoNaSolicitacaoPg(
      this.prisma,
      solicitacaoOsId ?? '',
      oficinaId,
    );

    if (solicitacaoOsId && !texto(dtoNormalizado.solicitacaoOsId)) {
      dtoNormalizado = {
        ...dtoNormalizado,
        solicitacaoOsId,
      };
    }

    const legacyId = texto(dto.id) || randomUUID();
    const createdAt = new Date().toISOString();

    try {
      const companyCtx = await resolveCompanyIdForChdPg(
        this.prisma,
        dtoNormalizado.prefeituraId,
        solicitacaoOsId,
      );
      if (!companyCtx) {
        throw new BadRequestException('Prefeitura não encontrada para o CHD.');
      }

      const number =
        texto(dto.number) ||
        (await nextNumeroDevolucaoPg(this.prisma, oficinaId));

      const doc = buildChecklistDevolucaoDoc(
        legacyId,
        number,
        {
          ...dtoNormalizado,
          prefeituraId: companyCtx.prefeituraLegacyId,
        },
        createdAt,
      );

      if (!doc.parts.items.length) {
        console.warn(
          'CHD salvo sem peças — verifique se o POST envia parts.items (JSON) ou campo data em multipart.',
          { id: doc.id, keys: Object.keys(body as object) },
        );
      }

      await this.prisma.checklistDevolucao.create({
        data: checklistDevolucaoToPrismaCreate(
          doc,
          companyCtx.companyId,
          legacyId,
        ),
      });

      const equipamentoId = await this.equipamentoIdDaSolicitacao(
        doc.solicitacaoOsId,
      );
      if (equipamentoId) {
        await this.equipamentosService.syncMedicaoFromChecklist(equipamentoId, {
          hourMeter: doc.identification.hourMeter,
          km: doc.identification.currentKm,
        });
      }

      return doc;
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      console.error('Erro ao criar checklist de devolução:', error);
      throw new InternalServerErrorException(
        'Não foi possível salvar o checklist de devolução.',
      );
    }
  }

  async atualizarFotos(
    id: string,
    body: unknown,
  ): Promise<ChecklistDevolucaoDoc> {
    const raw =
      body && typeof body === 'object'
        ? (body as Record<string, unknown>)
        : {};
    const docId = id.trim();
    if (!docId) throw new BadRequestException('id inválido.');

    const temGeneralState = raw.generalState != null;
    const temParts = raw.parts != null;
    if (!temGeneralState && !temParts) {
      throw new BadRequestException(
        'Informe generalState ou parts para atualizar.',
      );
    }

    try {
      const row = await resolveChecklistDevolucaoPg(this.prisma, docId);
      if (!row) {
        throw new NotFoundException('Checklist de devolução não encontrado.');
      }

      const atual = mapChecklistDevolucaoFromRow(row);
      const patch: Parameters<typeof checklistDevolucaoPatchToPrisma>[0] = {};

      if (temGeneralState && raw.generalState) {
        patch.generalState = {
          ...atual.generalState,
          ...mapGeneralStateItems(
            raw.generalState as Record<
              string,
              { status?: string; photo?: string; description?: string }
            >,
          ),
        };
      }

      if (temParts) {
        const partItems = extractPartsFromPatchBody(raw.parts);
        if (partItems.length > 0) {
          patch.parts = { items: partItems };
        }
      }

      const updated = await this.prisma.checklistDevolucao.update({
        where: { id: row.id },
        data: checklistDevolucaoPatchToPrisma(patch),
        include: { company: { select: { legacyId: true } } },
      });

      return mapChecklistDevolucaoFromRow(updated);
    } catch (error) {
      if (
        error instanceof BadRequestException ||
        error instanceof NotFoundException
      ) {
        throw error;
      }
      console.error('Erro ao atualizar fotos do checklist de devolução:', error);
      throw new InternalServerErrorException(
        'Não foi possível atualizar as fotos do checklist de devolução.',
      );
    }
  }

  async conferir(
    id: string,
    dto: ConferirChecklistDevolucaoDto,
  ): Promise<{
    data: ChecklistDevolucaoDoc;
    garantiasGeradas: number;
    solicitacaoStatus?: string;
    message: string;
  }> {
    const docId = id.trim();
    if (!docId) throw new BadRequestException('id inválido.');

    const conferidoEm = new Date().toISOString();
    const prefeituraConferencia = {
      aceito: dto.aceito,
      observacoes: texto(dto.observacoes) || null,
      conferidoPor: texto(dto.conferidoPor) || null,
      conferidoEm,
    };
    const novoStatus = dto.aceito ? 'aceito' : 'contestado';

    try {
      const row = await resolveChecklistDevolucaoPg(this.prisma, docId);
      if (!row) {
        throw new NotFoundException('Checklist de devolução não encontrado.');
      }

      const atual = mapChecklistDevolucaoFromRow(row);

      if (atual.status === 'aceito' || atual.status === 'contestado') {
        throw new ConflictException(
          'Este checklist de devolução já foi conferido.',
        );
      }

      let garantiasGeradas = 0;
      let solicitacaoStatus: string | undefined;

      if (dto.aceito) {
        const solId = texto(atual.solicitacaoOsId);
        if (!solId) {
          throw new BadRequestException(
            'solicitacaoOsId é obrigatório para aceitar e gerar garantias.',
          );
        }

        const sol = await loadServiceOrderForChdPg(this.prisma, solId);
        if (!sol) {
          throw new NotFoundException('Solicitação de OS não encontrada.');
        }

        const equipamentoId =
          sol.equipment?.legacyId ?? sol.equipmentId ?? '';
        const equipamento = texto(sol.equipmentNome);
        const prefeituraId =
          texto(atual.prefeituraId) || sol.company.legacyId || sol.companyId;

        if (!equipamentoId) {
          throw new BadRequestException(
            'A solicitação de OS não possui equipamentoId para vincular garantias.',
          );
        }

        const oficina = await findPartnerOficinaPg(this.prisma, atual.oficinaId);
        const fornecedor = oficina?.nome ?? atual.oficinaId;
        const horimetroAtual =
          parseHorimetro(atual.identification.hourMeter) ??
          parseHorimetro(atual.identification.currentKm);

        const existentes = await this.prisma.garantia.count({
          where: { checklistDevolucaoId: docId },
        });

        if (existentes > 0) {
          garantiasGeradas = existentes;
        } else {
          const chdAtualizado: ChecklistDevolucaoDoc = {
            ...atual,
            status: novoStatus,
            prefeituraConferencia,
            updatedAt: conferidoEm,
          };

          const registros =
            await this.garantiasService.gerarDeChecklistDevolucao(
              chdAtualizado,
              {
                prefeituraId,
                equipamentoId,
                equipamento,
                fornecedor,
                horimetroAtual,
              },
            );
          garantiasGeradas = registros.length;
        }

        await this.prisma.serviceOrder.updateMany({
          where: serviceOrderWhere(solId),
          data: { status: 'concluido' },
        });
        solicitacaoStatus = 'concluido';
      }

      const updated = await this.prisma.checklistDevolucao.update({
        where: { id: row.id },
        data: checklistDevolucaoPatchToPrisma({
          status: novoStatus,
          prefeituraConferencia,
        }),
        include: { company: { select: { legacyId: true } } },
      });

      return {
        data: mapChecklistDevolucaoFromRow(updated),
        garantiasGeradas,
        solicitacaoStatus,
        message: dto.aceito
          ? `Devolução aceita. ${garantiasGeradas} item(ns) de garantia registrado(s).`
          : 'Devolução contestada.',
      };
    } catch (error) {
      if (
        error instanceof BadRequestException ||
        error instanceof NotFoundException ||
        error instanceof ConflictException
      ) {
        throw error;
      }
      console.error('Erro ao conferir checklist de devolução:', error);
      throw new InternalServerErrorException(
        'Não foi possível conferir o checklist de devolução.',
      );
    }
  }

  async obter(id: string): Promise<ChecklistDevolucaoDoc> {
    const docId = id.trim();
    if (!docId) throw new BadRequestException('id inválido.');

    try {
      const row = await resolveChecklistDevolucaoPg(this.prisma, docId);
      if (!row) {
        throw new NotFoundException('Checklist de devolução não encontrado.');
      }
      return mapChecklistDevolucaoFromRow(row);
    } catch (error) {
      if (
        error instanceof BadRequestException ||
        error instanceof NotFoundException
      ) {
        throw error;
      }
      console.error('Erro ao buscar checklist de devolução:', error);
      throw new InternalServerErrorException(
        'Não foi possível buscar o checklist de devolução.',
      );
    }
  }

  async listarPorOficina(
    oficinaId: string,
  ): Promise<{ data: ChecklistDevolucaoDoc[]; message: string }> {
    const id = oficinaId.trim();
    if (!id) throw new BadRequestException('oficinaId inválido.');

    try {
      const rows = await this.prisma.checklistDevolucao.findMany({
        where: { oficinaId: id },
        include: { company: { select: { legacyId: true } } },
        orderBy: { createdAt: 'desc' },
      });

      const data = rows.map(mapChecklistDevolucaoFromRow);

      return {
        data,
        message: 'Checklists de devolução carregados com sucesso.',
      };
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      console.error('Erro ao listar checklists de devolução:', error);
      throw new InternalServerErrorException(
        'Não foi possível listar os checklists de devolução.',
      );
    }
  }

  async listarPorPrefeitura(
    prefeituraId: string,
  ): Promise<{ data: ChecklistDevolucaoDoc[]; message: string }> {
    const id = prefeituraId.trim();
    if (!id) throw new BadRequestException('prefeituraId inválido.');

    try {
      const companyId = await resolverCompanyId(this.prisma, id);
      const solIds = await listServiceOrderPublicIdsPg(this.prisma, id);

      const rows = await this.prisma.checklistDevolucao.findMany({
        where: {
          OR: [
            ...(companyId ? [{ companyId }] : []),
            ...(solIds.length
              ? [{ solicitacaoOsId: { in: solIds } }]
              : []),
            { company: companyWhere(id) },
          ],
        },
        include: { company: { select: { legacyId: true } } },
        orderBy: { createdAt: 'desc' },
      });

      const porId = new Map<string, ChecklistDevolucaoDoc>();
      for (const row of rows) {
        porId.set(row.id, mapChecklistDevolucaoFromRow(row));
      }

      const data = Array.from(porId.values()).sort((a, b) =>
        b.createdAt.localeCompare(a.createdAt),
      );

      return {
        data,
        message: 'Checklists de devolução carregados com sucesso.',
      };
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      console.error('Erro ao listar checklists de devolução:', error);
      throw new InternalServerErrorException(
        'Não foi possível listar os checklists de devolução.',
      );
    }
  }
}
