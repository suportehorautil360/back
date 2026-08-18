import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Prisma } from '../../prisma/generated/client';
import { PrismaService } from '../../prisma/prisma.service';
import { resolverCompanyId } from '../../common/prisma/company-resolver';
import {
  apiStatusToFrenteStatus,
  mapAllocationToApi,
  mapWorkFrontToApi,
} from '../../common/prisma/work-front-prisma.mapper';
import {
  resolveWorkFrontPg,
  workFrontWhere,
} from '../../common/prisma/work-front-resolver';
import { FirebaseService } from '../../config/firebase.service';
import { CreateWorkFrontDto } from './dto/create-work-front.dto';
import { UpdateWorkFrontDto } from './dto/update-work-front.dto';

@Injectable()
export class WorkFrontService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly firebaseService: FirebaseService,
  ) {}

  async create(createWorkFrontDto: CreateWorkFrontDto) {
    if (createWorkFrontDto.responsibleId) {
      await this.assertResponsavelDaPrefeitura(
        createWorkFrontDto.responsibleId,
        createWorkFrontDto.prefeituraId,
      );
    }

    try {
      const companyId = await resolverCompanyId(
        this.prisma,
        createWorkFrontDto.prefeituraId,
      );
      if (!companyId) {
        throw new BadRequestException('Prefeitura não encontrada.');
      }

      const legacyId = randomUUID();
      const row = await this.prisma.workFront.create({
        data: {
          legacyId,
          companyId,
          nome: createWorkFrontDto.name,
          endereco: createWorkFrontDto.address,
          responsavelLegacyId: createWorkFrontDto.responsibleId ?? null,
          responsavelNome: createWorkFrontDto.responsible,
          telefone: createWorkFrontDto.telefone ?? null,
          email: createWorkFrontDto.email ?? null,
          status: apiStatusToFrenteStatus(createWorkFrontDto.status),
          custo: (createWorkFrontDto.cost ?? 0).toFixed(2),
          inicio: createWorkFrontDto.startDate
            ? new Date(createWorkFrontDto.startDate)
            : null,
          fim: createWorkFrontDto.endDate
            ? new Date(createWorkFrontDto.endDate)
            : null,
        },
      });

      const newWorkFront = mapWorkFrontToApi(
        row,
        createWorkFrontDto.prefeituraId,
      );
      return {
        data: newWorkFront,
        message: 'Front de trabalho criado com sucesso',
      };
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      console.error('Error creating work front:', error);
      throw new InternalServerErrorException(
        'Ocorreu um erro ao criar o front de trabalho. Por favor, tente novamente mais tarde.',
      );
    }
  }

  async findAll(prefeituraId: string) {
    try {
      const companyId = await resolverCompanyId(this.prisma, prefeituraId);
      if (!companyId) {
        return {
          data: [],
          message: 'Fronts de trabalho com equipamentos recuperados com sucesso.',
        };
      }

      const [frentes, alocacoes] = await Promise.all([
        this.prisma.workFront.findMany({
          where: { companyId },
          orderBy: { createdAt: 'desc' },
        }),
        this.prisma.workFrontAllocation.findMany({
          where: {
            endDate: null,
            workFront: { companyId },
          },
          include: {
            workFront: { select: { id: true, legacyId: true, nome: true } },
            equipment: { select: { id: true, legacyId: true, placa: true } },
          },
        }),
      ]);

      const alocPorFrente = new Map<string, Record<string, unknown>[]>();
      for (const alloc of alocacoes) {
        const wfKey = alloc.workFrontId;
        const mapped = mapAllocationToApi(alloc, prefeituraId);
        const list = alocPorFrente.get(wfKey) ?? [];
        list.push(mapped);
        alocPorFrente.set(wfKey, list);
      }

      const workFrontsData = frentes.map((wf) => ({
        ...mapWorkFrontToApi(wf, prefeituraId),
        equipamentos: alocPorFrente.get(wf.id) ?? [],
      }));

      return {
        data: workFrontsData,
        message: 'Fronts de trabalho com equipamentos recuperados com sucesso.',
      };
    } catch (error) {
      console.error('Error fetching work fronts:', error);
      throw new InternalServerErrorException(
        'Ocorreu um erro ao buscar os dados. Tente novamente mais tarde.',
      );
    }
  }

  async update(workFrontId: string, updateDto: UpdateWorkFrontDto) {
    try {
      const existing = await resolveWorkFrontPg(this.prisma, workFrontId);
      if (!existing) {
        throw new NotFoundException('Frente de trabalho não encontrada.');
      }

      const prefeituraId =
        existing.company.legacyId ?? existing.companyId;

      if (updateDto.responsibleId !== undefined) {
        if (updateDto.responsibleId) {
          await this.assertResponsavelDaPrefeitura(
            updateDto.responsibleId,
            prefeituraId,
          );
        }
      } else if (updateDto.responsible !== undefined) {
        // Sem alteração de vínculo.
      }

      const data: Prisma.WorkFrontUpdateInput = {};

      if (updateDto.name !== undefined) data.nome = updateDto.name;
      if (updateDto.address !== undefined) data.endereco = updateDto.address;
      if (updateDto.responsible !== undefined) {
        data.responsavelNome = updateDto.responsible;
      }
      if (updateDto.responsibleId !== undefined) {
        data.responsavelLegacyId =
          updateDto.responsibleId.trim() === ''
            ? null
            : updateDto.responsibleId;
      }
      if (updateDto.telefone !== undefined) data.telefone = updateDto.telefone;
      if (updateDto.email !== undefined) data.email = updateDto.email;
      if (updateDto.status !== undefined) {
        data.status = apiStatusToFrenteStatus(updateDto.status);
      }
      if (updateDto.cost !== undefined) {
        data.custo = updateDto.cost.toFixed(2);
      }
      if (updateDto.startDate !== undefined) {
        data.inicio = updateDto.startDate
          ? new Date(updateDto.startDate)
          : null;
      }
      if (updateDto.endDate !== undefined) {
        data.fim = updateDto.endDate ? new Date(updateDto.endDate) : null;
      }

      if (Object.keys(data).length > 0) {
        await this.prisma.workFront.updateMany({
          where: workFrontWhere(workFrontId),
          data,
        });
      }

      return { message: 'Front de trabalho atualizado com sucesso' };
    } catch (error) {
      if (
        error instanceof NotFoundException ||
        error instanceof BadRequestException
      ) {
        throw error;
      }
      console.error('Error updating work front:', error);
      throw new InternalServerErrorException(
        'Ocorreu um erro ao atualizar o front de trabalho. Tente novamente mais tarde.',
      );
    }
  }

  /**
   * Designar a frente a um usuário de outra prefeitura a tornaria invisível
   * para todos: o responsável não a alcança (lista pela prefeitura dele) e
   * ninguém mais bate com o id.
   */
  private async assertResponsavelDaPrefeitura(
    responsibleId: string,
    prefeituraId: string | undefined,
  ) {
    const userDoc = await this.firebaseService
      .getFirestore()
      .collection('users')
      .doc(responsibleId)
      .get();

    if (!userDoc.exists) {
      throw new BadRequestException('Usuário responsável não encontrado.');
    }

    if (userDoc.data()?.prefeituraId !== prefeituraId) {
      throw new BadRequestException(
        'O responsável precisa ser um usuário desta prefeitura.',
      );
    }
  }

  async remove(workFrontId: string) {
    try {
      const existing = await resolveWorkFrontPg(this.prisma, workFrontId);
      if (!existing) {
        throw new NotFoundException('Frente de trabalho não encontrada.');
      }

      const alocacoes = await this.prisma.workFrontAllocation.findMany({
        where: { workFrontId: existing.id, endDate: null },
        select: { equipmentId: true },
      });

      const equipmentIds = [...new Set(alocacoes.map((a) => a.equipmentId))];

      await this.prisma.workFront.delete({
        where: { id: existing.id },
      });

      if (equipmentIds.length > 0) {
        await this.prisma.equipment.updateMany({
          where: { id: { in: equipmentIds } },
          data: { obra: '' },
        });
      }

      return {
        message: 'Front de trabalho removido com sucesso',
      };
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      console.error('Error removing work front:', error);
      throw new InternalServerErrorException(
        'Ocorreu um erro ao remover o front de trabalho. Tente novamente mais tarde.',
      );
    }
  }
}
