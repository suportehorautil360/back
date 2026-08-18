import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import {
  checklistChegadaPatchToPrisma,
  checklistChegadaToPrismaCreate,
  mapChecklistChegadaFromRow,
} from '../../common/prisma/checklist-chegada-prisma.mapper';
import { resolveChecklistChegadaPg } from '../../common/prisma/chegada-resolver';
import {
  assertOficinaTemOrcamentoNaSolicitacaoPg,
  loadServiceOrderForChdPg,
  resolveCompanyIdForChdPg,
  resolveSolicitacaoIdPorProtocoloPg,
} from '../../common/prisma/os-solicitacao.helper';
import { EquipamentosService } from '../equipamentos/equipamentos.service';
import type { ChecklistChegadaDoc } from './checklist-chegada.types';
import { CreateChecklistChegadaDto } from './dto/create-checklist-chegada.dto';
import { UpdateChecklistChegadaFotosDto } from './dto/update-checklist-chegada-fotos.dto';
import {
  buildChecklistChegadaDoc,
  mapChecklistItems,
  mapPhotos,
} from './helpers/checklist-chegada.mapper';
import { nextNumeroChegadaPg } from './helpers/gerar-numero-chegada.helper';

function texto(valor: unknown): string {
  return typeof valor === 'string' ? valor.trim() : '';
}

@Injectable()
export class ChecklistChegadaService {
  constructor(
    private readonly prisma: PrismaService,
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

  async criar(dto: CreateChecklistChegadaDto): Promise<ChecklistChegadaDoc> {
    const oficinaId = dto.oficinaId.trim();
    if (!oficinaId) {
      throw new BadRequestException('oficinaId é obrigatório.');
    }
    if (!texto(dto.identification?.os)) {
      throw new BadRequestException('identification.os é obrigatório.');
    }

    const solicitacaoOsId =
      texto(dto.solicitacaoOsId) ||
      (await resolveSolicitacaoIdPorProtocoloPg(
        this.prisma,
        dto.identification.os,
      ));

    await assertOficinaTemOrcamentoNaSolicitacaoPg(
      this.prisma,
      solicitacaoOsId ?? '',
      oficinaId,
    );

    const dtoComSolicitacao =
      solicitacaoOsId && !texto(dto.solicitacaoOsId)
        ? { ...dto, solicitacaoOsId }
        : dto;

    const legacyId = texto(dtoComSolicitacao.id) || randomUUID();
    const createdAt = new Date().toISOString();

    try {
      const companyCtx = await resolveCompanyIdForChdPg(
        this.prisma,
        dtoComSolicitacao.prefeituraId,
        solicitacaoOsId,
      );
      if (!companyCtx) {
        throw new BadRequestException('Prefeitura não encontrada para o CHE.');
      }

      const number =
        texto(dto.number) ||
        (await nextNumeroChegadaPg(this.prisma, oficinaId));

      const doc = buildChecklistChegadaDoc(
        legacyId,
        number,
        {
          ...dtoComSolicitacao,
          prefeituraId: companyCtx.prefeituraLegacyId,
        },
        createdAt,
      );

      await this.prisma.checklistChegada.create({
        data: checklistChegadaToPrismaCreate(
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
          km: doc.identification.km,
        });
      }

      return doc;
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      console.error('Erro ao criar checklist de chegada:', error);
      throw new InternalServerErrorException(
        'Não foi possível salvar o checklist de chegada.',
      );
    }
  }

  async atualizarFotos(
    id: string,
    dto: UpdateChecklistChegadaFotosDto,
  ): Promise<ChecklistChegadaDoc> {
    const docId = id.trim();
    if (!docId) throw new BadRequestException('id inválido.');

    const temPhotos = dto.photos != null;
    const temInspection = dto.inspection != null;
    const temBlocks = dto.blocks != null;
    if (!temPhotos && !temInspection && !temBlocks) {
      throw new BadRequestException(
        'Informe photos, inspection ou blocks para atualizar.',
      );
    }

    try {
      const row = await resolveChecklistChegadaPg(this.prisma, docId);
      if (!row) {
        throw new NotFoundException('Checklist de chegada não encontrado.');
      }

      const atual = mapChecklistChegadaFromRow(row);
      const patch: Parameters<typeof checklistChegadaPatchToPrisma>[0] = {};

      if (temPhotos && dto.photos) {
        patch.photos = { ...atual.photos, ...mapPhotos(dto.photos) };
      }
      if (temInspection && dto.inspection) {
        patch.inspection = {
          ...atual.inspection,
          ...mapChecklistItems(dto.inspection),
        };
      }
      if (temBlocks && dto.blocks) {
        patch.blocks = { ...atual.blocks, ...mapChecklistItems(dto.blocks) };
      }

      const updated = await this.prisma.checklistChegada.update({
        where: { id: row.id },
        data: checklistChegadaPatchToPrisma(patch),
        include: { company: { select: { legacyId: true } } },
      });

      return mapChecklistChegadaFromRow(updated);
    } catch (error) {
      if (
        error instanceof BadRequestException ||
        error instanceof NotFoundException
      ) {
        throw error;
      }
      console.error('Erro ao atualizar fotos do checklist:', error);
      throw new InternalServerErrorException(
        'Não foi possível atualizar as fotos do checklist.',
      );
    }
  }

  async obter(id: string): Promise<ChecklistChegadaDoc> {
    const docId = id.trim();
    if (!docId) throw new BadRequestException('id inválido.');

    try {
      const row = await resolveChecklistChegadaPg(this.prisma, docId);
      if (!row) {
        throw new NotFoundException('Checklist de chegada não encontrado.');
      }
      return mapChecklistChegadaFromRow(row);
    } catch (error) {
      if (
        error instanceof BadRequestException ||
        error instanceof NotFoundException
      ) {
        throw error;
      }
      console.error('Erro ao buscar checklist de chegada:', error);
      throw new InternalServerErrorException(
        'Não foi possível buscar o checklist de chegada.',
      );
    }
  }

  async listarPorOficina(
    oficinaId: string,
  ): Promise<{ data: ChecklistChegadaDoc[]; message: string }> {
    const id = oficinaId.trim();
    if (!id) throw new BadRequestException('oficinaId inválido.');

    try {
      const rows = await this.prisma.checklistChegada.findMany({
        where: { oficinaId: id },
        include: { company: { select: { legacyId: true } } },
        orderBy: { createdAt: 'desc' },
      });

      return {
        data: rows.map(mapChecklistChegadaFromRow),
        message: 'Checklists de chegada carregados com sucesso.',
      };
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      console.error('Erro ao listar checklists de chegada:', error);
      throw new InternalServerErrorException(
        'Não foi possível listar os checklists de chegada.',
      );
    }
  }
}
