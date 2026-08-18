import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { companyWhere, resolverCompanyId } from '../../common/prisma/company-resolver';
import { resolveEquipmentByIdPg } from '../../common/prisma/equipment-resolver';
import {
  mapRevisionToApi,
  normalizeUnidadeRevisao,
} from '../../common/prisma/revision-prisma.mapper';
import { CreateRevisionDto } from './dto/create-revision.dto';

@Injectable()
export class RevisionService {
  constructor(private readonly prisma: PrismaService) {}

  private normalizeTipo(value?: string): string {
    return (value ?? '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim()
      .toLowerCase();
  }

  private normalizeUnidade(value?: string): 'km' | 'horas' | undefined {
    const unidade = this.normalizeTipo(value);
    if (!unidade) return undefined;
    if (unidade === 'km' || unidade.includes('quilometr')) return 'km';
    if (
      unidade === 'h' ||
      unidade.includes('hora') ||
      unidade.includes('hour')
    ) {
      return 'horas';
    }
    return undefined;
  }

  private resolveTipoKeys(rawTipo?: string): string[] {
    const tipo = this.normalizeTipo(rawTipo);
    if (!tipo) return [];

    if (tipo.includes('carro') || tipo === 'car' || tipo.includes('cars')) {
      return ['carro', 'carros', 'car'];
    }
    if (
      tipo.includes('caminhao') ||
      tipo.includes('caminhoes') ||
      tipo.includes('truck')
    ) {
      return ['caminhao', 'caminhoes', 'truck'];
    }
    if (
      tipo.includes('maquina') ||
      tipo.includes('maquinas') ||
      tipo.includes('machine')
    ) {
      return ['maquina', 'maquinas', 'machine'];
    }
    if (tipo.includes('ambulancia') || tipo.includes('ambulance')) {
      return ['ambulancia', 'ambulancias', 'ambulance'];
    }
    if (tipo.includes('van')) {
      return ['van', 'vans'];
    }
    return [];
  }

  private getIntervaloPorTipo(
    configuracao: Record<string, unknown> | null,
    tipoVeiculo?: string,
  ): { valor: number; unidade?: 'km' | 'horas' } | undefined {
    if (!configuracao) return undefined;

    const keys = this.resolveTipoKeys(tipoVeiculo);
    if (!keys.length) return undefined;

    const intervalos = configuracao.intervalos as
      | Record<string, { valor?: number; unidade?: string }>
      | undefined;

    for (const key of keys) {
      const intervalo = intervalos?.[key];
      const valor = intervalo?.valor;
      if (typeof valor === 'number' && Number.isFinite(valor) && valor > 0) {
        return {
          valor,
          unidade: this.normalizeUnidade(intervalo?.unidade),
        };
      }
    }

    return undefined;
  }

  private resolveIntervaloRevisao(
    configuracao: Record<string, unknown> | null,
    vehicleData: {
      intervaloRevisao?: number | null;
      unidadeRevisao?: string | null;
      tipo?: string | null;
    },
  ): { valor: number; unidade: 'km' | 'horas' } {
    const intervaloConfig = this.getIntervaloPorTipo(
      configuracao,
      vehicleData.tipo ?? undefined,
    );
    if (intervaloConfig) {
      return {
        valor: intervaloConfig.valor,
        unidade: intervaloConfig.unidade ?? 'km',
      };
    }

    const intervaloVeiculo = vehicleData.intervaloRevisao;
    if (
      typeof intervaloVeiculo === 'number' &&
      Number.isFinite(intervaloVeiculo) &&
      intervaloVeiculo > 0
    ) {
      return {
        valor: intervaloVeiculo,
        unidade:
          this.normalizeUnidade(vehicleData.unidadeRevisao ?? undefined) ??
          'km',
      };
    }

    return { valor: 1000, unidade: 'km' };
  }

  private async loadConfiguracao(prefeituraId: string) {
    const companyId = await resolverCompanyId(this.prisma, prefeituraId);
    if (!companyId) return null;

    const settings = await this.prisma.companySettings.findUnique({
      where: { companyId },
      select: { intervalos: true },
    });
    if (!settings) return null;

    return { intervalos: settings.intervalos } as Record<string, unknown>;
  }

  async create(createRevisionDto: CreateRevisionDto) {
    const revisionId = randomUUID();
    try {
      const equip = await resolveEquipmentByIdPg(
        this.prisma,
        createRevisionDto.prefeituraId,
        createRevisionDto.vehicleId,
      );

      const row = await this.prisma.equipment.findUnique({
        where: { id: equip.equipmentUuid },
        select: {
          id: true,
          tipo: true,
          medicaoAtual: true,
          ultimaRevisao: true,
          intervaloRevisao: true,
          unidadeRevisao: true,
        },
      });
      if (!row) {
        throw new NotFoundException(
          'Veículo não encontrado para o ID fornecido.',
        );
      }

      const configuracao = await this.loadConfiguracao(
        createRevisionDto.prefeituraId,
      );
      const intervaloRevisao = this.resolveIntervaloRevisao(configuracao, row);
      const unidadeMensagem = intervaloRevisao.unidade;
      const descricaoMedicao =
        unidadeMensagem === 'horas' ? 'A medição' : 'A quilometragem';

      const lastOdometer = row.ultimaRevisao ?? 0;
      const currentMeter = row.medicaoAtual ?? 0;

      if (
        createRevisionDto.odometerReading <=
        lastOdometer + intervaloRevisao.valor
      ) {
        throw new BadRequestException(
          `${descricaoMedicao} deve ser pelo menos ${intervaloRevisao.valor} ${unidadeMensagem} maior que a última revisão (${lastOdometer} ${unidadeMensagem}).`,
        );
      }

      if (createRevisionDto.odometerReading < currentMeter) {
        throw new BadRequestException(
          'A quilometragem não pode ser menor que a atual do veículo.',
        );
      }

      const revisionDate = new Date(createRevisionDto.revisionDate);
      const unidade =
        normalizeUnidadeRevisao(row.unidadeRevisao) === 'horas' ? 'h' : 'km';

      await this.prisma.$transaction([
        this.prisma.equipmentRevision.create({
          data: {
            id: revisionId,
            equipmentId: row.id,
            data: revisionDate,
            leitura: createRevisionDto.odometerReading,
            unidade,
            oficina: createRevisionDto.mechanicOrOfficeName,
            custo: createRevisionDto.revisionCost,
            notaFiscal: createRevisionDto.invoiceNumber,
            servicos: createRevisionDto.servicesDescription,
            status: 'Pendente',
          },
        }),
        this.prisma.equipment.update({
          where: { id: row.id },
          data: { status: 'bloqueado' },
        }),
      ]);

      const newRevision = {
        id: revisionId,
        ...createRevisionDto,
        status: 'Pendente',
        createdAt: new Date().toISOString(),
      };

      return {
        data: newRevision,
        message: 'Revisão criada com sucesso',
      };
    } catch (error) {
      console.error('Erro ao salvar revisão:', error);
      if (
        error instanceof BadRequestException ||
        error instanceof NotFoundException
      ) {
        throw error;
      }
      throw new InternalServerErrorException(
        'Ocorreu um erro ao salvar a revisão. Por favor, tente novamente mais tarde.',
      );
    }
  }

  async complete(createRevisionDto: CreateRevisionDto) {
    const revisionId = randomUUID();
    try {
      const equip = await resolveEquipmentByIdPg(
        this.prisma,
        createRevisionDto.prefeituraId,
        createRevisionDto.vehicleId,
      );

      const row = await this.prisma.equipment.findUnique({
        where: { id: equip.equipmentUuid },
        select: {
          id: true,
          medicaoAtual: true,
          unidadeRevisao: true,
        },
      });
      if (!row) {
        throw new NotFoundException(
          'Veículo não encontrado para o ID fornecido.',
        );
      }

      const currentMeter = row.medicaoAtual ?? 0;
      if (createRevisionDto.odometerReading < currentMeter) {
        throw new BadRequestException(
          'A quilometragem não pode ser menor que a atual do veículo.',
        );
      }

      const revisionDate = new Date(createRevisionDto.revisionDate);
      const unidade =
        normalizeUnidadeRevisao(row.unidadeRevisao) === 'horas' ? 'h' : 'km';

      await this.prisma.$transaction([
        this.prisma.equipmentRevision.create({
          data: {
            id: revisionId,
            equipmentId: row.id,
            data: revisionDate,
            leitura: createRevisionDto.odometerReading,
            unidade,
            oficina: createRevisionDto.mechanicOrOfficeName,
            custo: createRevisionDto.revisionCost,
            notaFiscal: createRevisionDto.invoiceNumber,
            servicos: createRevisionDto.servicesDescription,
            status: 'Concluída',
          },
        }),
        this.prisma.equipment.update({
          where: { id: row.id },
          data: {
            medicaoAtual: createRevisionDto.odometerReading,
            ultimaRevisao: createRevisionDto.odometerReading,
            status: 'ativo',
          },
        }),
      ]);

      const newRevision = {
        id: revisionId,
        ...createRevisionDto,
        status: 'Concluída',
        createdAt: new Date().toISOString(),
      };

      return {
        data: newRevision,
        message: 'Revisão concluída e veículo liberado com sucesso',
      };
    } catch (error) {
      console.error('Erro ao concluir revisão:', error);
      if (
        error instanceof BadRequestException ||
        error instanceof NotFoundException
      ) {
        throw error;
      }
      throw new InternalServerErrorException(
        'Ocorreu um erro ao concluir a revisão. Por favor, tente novamente mais tarde.',
      );
    }
  }

  async findAllById(id: string) {
    try {
      const rows = await this.prisma.equipmentRevision.findMany({
        where: {
          equipment: { company: companyWhere(id) },
        },
        include: {
          equipment: {
            select: {
              id: true,
              legacyId: true,
              tipo: true,
              company: { select: { id: true, legacyId: true } },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      });

      if (!rows.length) {
        throw new NotFoundException(
          'Nenhuma revisão encontrada para a prefeitura fornecida.',
        );
      }

      const revisions = rows.map(mapRevisionToApi);
      return {
        data: revisions,
        message: 'Revisões buscadas com sucesso',
      };
    } catch (error) {
      console.error('Erro ao buscar revisões:', error);
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException(
        'Ocorreu um erro ao buscar as revisões. Por favor, tente novamente mais tarde.',
      );
    }
  }
}
