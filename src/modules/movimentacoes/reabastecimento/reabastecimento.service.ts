import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { resolverCompanyId } from '../../../common/prisma/company-resolver';
import { creditarTanquePrismaTx } from '../../../common/prisma/tank-saldo-prisma.helper';
import { PrismaService } from '../../../prisma/prisma.service';
import { formatDateTime } from '../shared/date.helper';
import { CreateReabastecimentoDto } from './dto/create-reabastecimento.dto';
import {
  isSupportedSourceType,
  parseReceivedLiters,
} from './helpers/reabastecimento-create.helper';

export interface ReabastecimentoDoc {
  id: string;
  prefeituraId: string;
  comboioId: string;
  sourceType: string;
  receivedLiters: number;
  invoiceNumber?: string;
  funcionarioId?: string;
  clientRequestId?: string;
  createdAt: string;
}

export interface ReabastecimentoListItem {
  id: string;
  dateTime: string;
  comboioId: string | null;
  sourceType: string;
  receivedLiters: number;
  invoiceNumber: string | null;
  funcionarioId: string | null;
  createdAt: string;
}

@Injectable()
export class ReabastecimentoService {
  constructor(private readonly prisma: PrismaService) {}

  async create(input: CreateReabastecimentoDto): Promise<ReabastecimentoDoc> {
    const receivedLiters = parseReceivedLiters(input.receivedLiters);
    if (receivedLiters === null) {
      throw new BadRequestException(
        'The field receivedLiters must be greater than zero.',
      );
    }

    if (!isSupportedSourceType(input.sourceType)) {
      throw new BadRequestException(
        'The field sourceType must be gasStation, farmTank or distributor.',
      );
    }

    const comboioId = input.comboioId?.trim();
    if (!comboioId) {
      throw new BadRequestException('Informe o comboio (comboioId) da carga.');
    }

    const companyId = await resolverCompanyId(this.prisma, input.prefeituraId);
    if (!companyId) {
      throw new BadRequestException('Empresa não encontrada.');
    }

    const comboio = await this.prisma.equipment.findFirst({
      where: {
        companyId,
        OR: [{ id: comboioId }, { legacyId: comboioId }],
      },
      select: { id: true, legacyId: true },
    });
    if (!comboio) {
      throw new BadRequestException('Comboio não encontrado.');
    }

    const id = randomUUID();
    const now = new Date();

    const doc: ReabastecimentoDoc = {
      id,
      prefeituraId: input.prefeituraId,
      comboioId: comboio.legacyId ?? comboio.id,
      sourceType: input.sourceType,
      receivedLiters,
      invoiceNumber: input.invoiceNumber,
      funcionarioId: input.funcionarioId?.trim() || undefined,
      clientRequestId: input.clientRequestId,
      createdAt: now.toISOString(),
    };

    try {
      await this.prisma.$transaction(async (tx) => {
        await creditarTanquePrismaTx(tx, comboioId, receivedLiters);
        await tx.comboioReabastecimento.create({
          data: {
            id,
            legacyId: id,
            companyId,
            equipmentId: comboio.id,
            sourceType: input.sourceType,
            receivedLiters: receivedLiters.toFixed(2),
            invoiceNumber: input.invoiceNumber ?? null,
            createdAt: now,
          },
        });
      });
      return doc;
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      console.error('Erro ao criar reabastecimento:', error);
      throw new InternalServerErrorException(
        'Não foi possível registrar o reabastecimento.',
      );
    }
  }

  async listarPorPrefeitura(
    prefeituraId: string,
    startDate?: string,
    endDate?: string,
  ): Promise<{ data: ReabastecimentoListItem[]; message: string }> {
    try {
      const companyId = await resolverCompanyId(this.prisma, prefeituraId);
      if (!companyId) {
        return { data: [], message: 'Reabastecimentos buscados com sucesso!' };
      }

      const where: {
        companyId: string;
        createdAt?: { gte?: Date; lte?: Date };
      } = { companyId };

      if (startDate) {
        where.createdAt = {
          ...where.createdAt,
          gte: new Date(`${startDate}T00:00:00.000Z`),
        };
      }
      if (endDate) {
        where.createdAt = {
          ...where.createdAt,
          lte: new Date(`${endDate}T23:59:59.999Z`),
        };
      }

      const rows = await this.prisma.comboioReabastecimento.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        include: {
          equipment: { select: { legacyId: true, id: true } },
        },
      });

      const data = rows.map((row) =>
        this.mapToListItem({
          id: row.legacyId ?? row.id,
          prefeituraId,
          comboioId: row.equipment?.legacyId ?? row.equipmentId ?? '',
          sourceType: row.sourceType,
          receivedLiters: Number(row.receivedLiters),
          invoiceNumber: row.invoiceNumber ?? undefined,
          createdAt: row.createdAt.toISOString(),
        }),
      );

      return { data, message: 'Reabastecimentos buscados com sucesso!' };
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      console.error('Erro ao buscar reabastecimentos:', error);
      throw new InternalServerErrorException(
        'Não foi possível buscar os reabastecimentos.',
      );
    }
  }

  private mapToListItem(doc: ReabastecimentoDoc): ReabastecimentoListItem {
    return {
      id: doc.id,
      dateTime: formatDateTime(doc.createdAt),
      comboioId: doc.comboioId ?? null,
      sourceType: doc.sourceType,
      receivedLiters: doc.receivedLiters,
      invoiceNumber: doc.invoiceNumber ?? null,
      funcionarioId: doc.funcionarioId ?? null,
      createdAt: doc.createdAt,
    };
  }
}
