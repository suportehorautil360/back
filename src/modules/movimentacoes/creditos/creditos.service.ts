import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { mapAbastecimentoRowsToGastoInput } from '../../../common/prisma/abastecimento-api.mapper';
import { resolverCompanyId } from '../../../common/prisma/company-resolver';
import {
  fetchEquipmentMapPg,
  resolveEquipmentByIdPg,
  resolveEquipmentIdByPlateOrChassisPg,
} from '../../../common/prisma/equipment-resolver';
import { mapEquipmentToApi } from '../../../common/prisma/equipment-api.mapper';
import { PrismaService } from '../../../prisma/prisma.service';
import { CreateCreditoDto } from './dto/create-credito.dto';
import {
  buildEquipamentoKeywords,
  buildEquipamentoLabel,
  buildFrenteLabel,
  creditTypeLabel,
  formatCreditAmountLabel,
  formatCreditDateLabel,
  parseCreditAmount,
  resolveEquipmentPlateOrChassis,
} from './helpers/creditos-create.helper';
import { buildCreditosSaldosPayload } from './helpers/creditos-saldos.helper';
import type {
  CreditoDoc,
  CreditoFormOpcoes,
  CreditoListItem,
  CreditoOpcaoItem,
  CreditoSaldosPayload,
} from './creditos.types';
import { RESPONSIBLE_OPTIONS } from './creditos.types';

@Injectable()
export class CreditosService {
  constructor(private readonly prisma: PrismaService) {}

  async create(input: CreateCreditoDto): Promise<CreditoDoc> {
    const amount = parseCreditAmount(input.amount);
    if (amount === null) {
      throw new BadRequestException(
        'The field amount must be greater than zero.',
      );
    }

    const companyId = await this.requireCompanyId(input.prefeituraId);
    const target = await this.resolveTarget(input, companyId);
    const id = randomUUID();
    const now = new Date();

    try {
      await this.prisma.credito.create({
        data: {
          id,
          legacyId: id,
          companyId,
          tipo: input.type,
          equipmentId: target.equipmentUuid,
          plateOrChassis:
            input.type === 'equipment' ? input.plateOrChassis!.trim() : null,
          workFrontId: target.workFrontUuid,
          targetLabel: target.label,
          amount: amount.toFixed(2),
          responsible: input.responsible.trim(),
          observation: input.observation?.trim() || null,
          createdAt: now,
        },
      });

      return {
        id,
        prefeituraId: input.prefeituraId.trim(),
        type: input.type,
        equipmentId: target.equipmentPublicId,
        plateOrChassis:
          input.type === 'equipment' ? input.plateOrChassis!.trim() : null,
        workFrontId: target.workFrontPublicId,
        targetLabel: target.label,
        amount,
        responsible: input.responsible.trim(),
        observation: input.observation?.trim() || undefined,
        createdAt: now.toISOString(),
      };
    } catch (error) {
      console.error('Erro ao criar crédito:', error);
      throw new InternalServerErrorException(
        'Não foi possível lançar o crédito.',
      );
    }
  }

  async listarOpcoesFormulario(
    prefeituraId: string,
  ): Promise<{ data: CreditoFormOpcoes; message: string }> {
    try {
      const [equipment, workFronts] = await Promise.all([
        this.listarEquipamentosOpcoes(prefeituraId),
        this.listarFrentesOpcoes(prefeituraId),
      ]);

      return {
        data: {
          typeOptions: [
            { value: 'equipment', label: 'Equipamento' },
            { value: 'workFront', label: 'Frente de trabalho' },
          ],
          equipment,
          workFronts,
          responsibleOptions: [...RESPONSIBLE_OPTIONS],
          suggestedAmounts: [200, 500, 1000, 2000, 5000],
        },
        message: 'Opções do formulário carregadas com sucesso!',
      };
    } catch (error) {
      console.error('Erro ao buscar opções de crédito:', error);
      throw new InternalServerErrorException(
        'Não foi possível carregar as opções do formulário.',
      );
    }
  }

  async listarSaldos(
    prefeituraId: string,
  ): Promise<{ data: CreditoSaldosPayload; message: string }> {
    try {
      const companyId = await resolverCompanyId(this.prisma, prefeituraId);
      if (!companyId) {
        return {
          data: { saldosEquipamento: [], saldosFrente: [] },
          message: 'Saldos de crédito buscados com sucesso!',
        };
      }

      const [creditosRows, abastecimentosRows, allocationsRows, workFrontsRows] =
        await Promise.all([
          this.prisma.credito.findMany({
            where: { companyId },
            include: {
              equipment: { select: { legacyId: true } },
              workFront: { select: { legacyId: true } },
            },
          }),
          this.prisma.abastecimento.findMany({
            where: { companyId },
            include: { equipment: { select: { legacyId: true } } },
          }),
          this.prisma.workFrontAllocation.findMany({
            where: {
              endDate: null,
              workFront: { companyId },
            },
            include: {
              workFront: { select: { legacyId: true, id: true, nome: true } },
              equipment: { select: { legacyId: true, id: true } },
            },
          }),
          this.prisma.workFront.findMany({
            where: { companyId },
            select: { id: true, legacyId: true, nome: true },
          }),
        ]);

      const creditos: CreditoDoc[] = creditosRows.map((row) =>
        this.mapCreditoRow(row, prefeituraId),
      );

      const allocations = allocationsRows
        .filter((row) => row.equipment && row.workFront)
        .map((row) => ({
          vehicleId:
            row.equipment!.legacyId ?? row.equipment!.id,
          workFrontId:
            row.workFront!.legacyId ?? row.workFront!.id,
          workFrontName: row.workFront!.nome,
        }));

      const workFrontNames = new Map<string, string>();
      for (const wf of workFrontsRows) {
        const id = wf.legacyId ?? wf.id;
        workFrontNames.set(id, buildFrenteLabel({ nome: wf.nome, id }));
      }

      const equipmentIds = [
        ...new Set([
          ...creditos
            .map((item) => item.equipmentId)
            .filter((id): id is string => !!id),
          ...abastecimentosRows.map(
            (row) => row.equipment?.legacyId ?? row.equipmentId ?? '',
          ),
          ...allocations.map((item) => item.vehicleId).filter(Boolean),
        ]),
      ];

      const equipmentMap = await fetchEquipmentMapPg(
        this.prisma,
        equipmentIds.filter(Boolean),
      );

      const gastoInputs = mapAbastecimentoRowsToGastoInput(abastecimentosRows);

      const data = buildCreditosSaldosPayload({
        creditos,
        abastecimentos: gastoInputs.map((item) => ({
          equipmentId: item.equipmentId ?? '',
          total: item.total != null ? Number(item.total) : null,
          status: item.status != null ? String(item.status) : null,
        })),
        allocations,
        equipmentMap,
        workFrontNames,
      });

      return { data, message: 'Saldos de crédito buscados com sucesso!' };
    } catch (error) {
      console.error('Erro ao buscar saldos de crédito:', error);
      throw new InternalServerErrorException(
        'Não foi possível buscar os saldos de crédito.',
      );
    }
  }

  async listarPorPrefeitura(
    prefeituraId: string,
  ): Promise<{ data: CreditoListItem[]; message: string }> {
    try {
      const companyId = await resolverCompanyId(this.prisma, prefeituraId);
      if (!companyId) {
        return { data: [], message: 'Créditos buscados com sucesso!' };
      }

      const rows = await this.prisma.credito.findMany({
        where: { companyId },
        orderBy: { createdAt: 'desc' },
        include: {
          equipment: { select: { legacyId: true } },
          workFront: { select: { legacyId: true } },
        },
      });

      const data = rows.map((row) =>
        this.mapToListItem(this.mapCreditoRow(row, prefeituraId)),
      );

      return { data, message: 'Créditos buscados com sucesso!' };
    } catch (error) {
      console.error('Erro ao buscar créditos:', error);
      throw new InternalServerErrorException(
        'Não foi possível buscar os créditos.',
      );
    }
  }

  private mapCreditoRow(
    row: {
      id: string;
      legacyId: string | null;
      tipo: string;
      equipmentId: string | null;
      plateOrChassis: string | null;
      workFrontId: string | null;
      targetLabel: string;
      amount: unknown;
      responsible: string;
      observation: string | null;
      createdAt: Date;
      equipment?: { legacyId: string | null } | null;
      workFront?: { legacyId: string | null } | null;
    },
    prefeituraId: string,
  ): CreditoDoc {
    return {
      id: row.legacyId ?? row.id,
      prefeituraId,
      type: row.tipo as CreditoDoc['type'],
      equipmentId: row.equipment?.legacyId ?? row.equipmentId,
      plateOrChassis: row.plateOrChassis,
      workFrontId: row.workFront?.legacyId ?? row.workFrontId,
      targetLabel: row.targetLabel,
      amount: Number(row.amount),
      responsible: row.responsible,
      observation: row.observation ?? undefined,
      createdAt: row.createdAt.toISOString(),
    };
  }

  private async resolveTarget(
    input: CreateCreditoDto,
    companyId: string,
  ): Promise<{
    label: string;
    equipmentPublicId: string | null;
    equipmentUuid: string | null;
    workFrontPublicId: string | null;
    workFrontUuid: string | null;
  }> {
    if (input.type === 'equipment') {
      if (!input.plateOrChassis?.trim()) {
        throw new BadRequestException(
          'The field plateOrChassis is required when type = equipment.',
        );
      }
      if (input.workFrontId) {
        throw new BadRequestException(
          'Do not send workFrontId when type = equipment.',
        );
      }

      const plateOrChassis = input.plateOrChassis.trim();
      const equip = await resolveEquipmentByIdPg(
        this.prisma,
        input.prefeituraId,
        await resolveEquipmentIdByPlateOrChassisPg(
          this.prisma,
          input.prefeituraId,
          plateOrChassis,
        ),
      );

      return {
        label: buildEquipamentoLabel(equip.raw),
        equipmentPublicId: equip.id,
        equipmentUuid: equip.equipmentUuid,
        workFrontPublicId: null,
        workFrontUuid: null,
      };
    }

    if (!input.workFrontId?.trim()) {
      throw new BadRequestException(
        'The field workFrontId is required when type = workFront.',
      );
    }
    if (input.plateOrChassis) {
      throw new BadRequestException(
        'Do not send plateOrChassis when type = workFront.',
      );
    }

    const workFront = await this.findFrenteTrabalho(
      companyId,
      input.workFrontId.trim(),
    );

    return {
      label: buildFrenteLabel(workFront),
      equipmentPublicId: null,
      equipmentUuid: null,
      workFrontPublicId: workFront.publicId,
      workFrontUuid: workFront.uuid,
    };
  }

  private async findFrenteTrabalho(companyId: string, workFrontId: string) {
    const row = await this.prisma.workFront.findFirst({
      where: {
        companyId,
        OR: [{ id: workFrontId }, { legacyId: workFrontId }],
      },
    });

    if (!row) {
      throw new NotFoundException(
        'Frente de trabalho não encontrada para esta prefeitura.',
      );
    }

    return {
      uuid: row.id,
      publicId: row.legacyId ?? row.id,
      nome: row.nome,
      id: row.legacyId ?? row.id,
    };
  }

  private async listarEquipamentosOpcoes(
    prefeituraId: string,
  ): Promise<CreditoOpcaoItem[]> {
    const companyId = await resolverCompanyId(this.prisma, prefeituraId);
    if (!companyId) return [];

    const rows = await this.prisma.equipment.findMany({
      where: { companyId },
      orderBy: { descricao: 'asc' },
    });

    return rows
      .map((row) => {
        const raw = mapEquipmentToApi(row, prefeituraId) as Record<
          string,
          unknown
        >;
        const id =
          resolveEquipmentPlateOrChassis(raw) || String(raw.id ?? row.id);
        return {
          id,
          label: buildEquipamentoLabel(raw),
          keywords: buildEquipamentoKeywords(raw),
        };
      })
      .filter((item) => item.id)
      .sort((a, b) => a.label.localeCompare(b.label, 'pt-BR'));
  }

  private async listarFrentesOpcoes(
    prefeituraId: string,
  ): Promise<CreditoOpcaoItem[]> {
    const companyId = await resolverCompanyId(this.prisma, prefeituraId);
    if (!companyId) return [];

    const rows = await this.prisma.workFront.findMany({
      where: { companyId },
      orderBy: { nome: 'asc' },
    });

    return rows
      .map((row) => {
        const id = row.legacyId ?? row.id;
        return {
          id,
          label: buildFrenteLabel({ nome: row.nome, id }),
        };
      })
      .filter((item) => item.id)
      .sort((a, b) => a.label.localeCompare(b.label, 'pt-BR'));
  }

  private mapToListItem(doc: CreditoDoc): CreditoListItem {
    return {
      id: doc.id,
      type: doc.type,
      typeLabel: creditTypeLabel(doc.type),
      targetLabel: doc.targetLabel,
      amount: doc.amount,
      amountLabel: formatCreditAmountLabel(doc.amount),
      responsible: doc.responsible,
      observation: doc.observation ?? null,
      createdAt: doc.createdAt,
      dateLabel: formatCreditDateLabel(doc.createdAt),
    };
  }

  private async requireCompanyId(prefeituraId: string): Promise<string> {
    const companyId = await resolverCompanyId(this.prisma, prefeituraId);
    if (!companyId) {
      throw new BadRequestException('Empresa não encontrada.');
    }
    return companyId;
  }
}
