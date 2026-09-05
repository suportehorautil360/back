import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  ehComboioTipo,
  ehCondutorDoEquipamentoRow,
  mapEquipmentToApi,
} from '../../common/prisma/equipment-api.mapper';
import {
  mapCreateEquipamentoToPrisma,
  mapUpdateEquipamentoToPrisma,
} from '../../common/prisma/equipment-prisma.mapper';
import { ensureTankForComboioPg } from '../../common/prisma/equipment-resolver';
import { tankStatusPg } from '../../common/prisma/tank-saldo-prisma.helper';
import { resolverCompanyId } from '../../common/prisma/company-resolver';
import {
  deveAplicarMedicaoChecklist,
  resolverLeituraParaUnidade,
  type MedicaoChecklistTexto,
} from './helpers/sync-medicao-from-texto.helper';
import { randomUUID } from 'node:crypto';
import { CreateEquipamentoDto } from './dto/create-equipamento.dto';
import { UpdateEquipamentoDto } from './dto/update-equipamento.dto';
import { CompleteRevisaoEquipDto } from './dto/complete-revisao-equip.dto';

function txt(valor: unknown): string {
  return typeof valor === 'string' ? valor : '';
}

function nmr(valor: unknown): number {
  const n = Number(valor);
  return Number.isFinite(n) ? n : 0;
}

@Injectable()
export class EquipamentosService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateEquipamentoDto) {
    const companyId = await resolverCompanyId(this.prisma, dto.prefeituraId);
    if (!companyId) {
      throw new BadRequestException('Empresa não encontrada.');
    }

    const id = randomUUID();
    try {
      const data = mapCreateEquipamentoToPrisma(dto, companyId, id);
      await this.prisma.equipment.create({ data });

      if (ehComboioTipo(dto.tipo)) {
        await ensureTankForComboioPg(this.prisma, id);
      }

      const novo = {
        id,
        ...dto,
        label: dto.descricao,
        status: dto.status ?? 'ativo',
        createdAt: new Date().toISOString(),
      };
      return { data: novo, message: 'Equipamento criado com sucesso!' };
    } catch (error) {
      console.error('Erro ao salvar equipamento:', error);
      throw new InternalServerErrorException(
        'Não foi possível salvar o equipamento no banco de dados.',
      );
    }
  }

  /** Busca um equipamento pelo id (UUID Postgres ou legacyId). */
  async findById(id: string) {
    const prismaRow = await this.prisma.equipment.findFirst({
      where: { OR: [{ id }, { legacyId: id }] },
      include: { company: { select: { legacyId: true } } },
    });
    if (prismaRow) {
      const prefeituraId = prismaRow.company.legacyId ?? prismaRow.companyId;
      return {
        data: mapEquipmentToApi(prismaRow, prefeituraId),
        message: 'Equipamento encontrado.',
      };
    }

    throw new NotFoundException('Equipamento não encontrado.');
  }

  /** Se `id` é UUID válido, devolve; senão devolve UUID nulo (não bate em companyId). */
  private tryUuid(id: string): string {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
      ? id
      : '00000000-0000-0000-0000-000000000000';
  }

  /** Lista os equipamentos da prefeitura. Sem registros => lista vazia (200). */
  async findAllByPrefeitura(prefeituraId: string) {
    try {
      const prismaRows = await this.prisma.equipment.findMany({
        where: {
          OR: [
            { companyId: this.tryUuid(prefeituraId) },
            { company: { legacyId: prefeituraId } },
          ],
        },
        select: {
          id: true,
          legacyId: true,
          descricao: true,
          chassi: true,
          modelo: true,
          linha: true,
          tipo: true,
          placa: true,
          marca: true,
          ano: true,
          obra: true,
          status: true,
          medicaoAtual: true,
          intervaloRevisao: true,
          ultimaRevisao: true,
          unidadeRevisao: true,
        },
        orderBy: { descricao: 'asc' },
      });

      if (prismaRows.length > 0) {
        const data = prismaRows.map((e) => ({
          id: e.legacyId ?? e.id,
          prefeituraId,
          descricao: e.descricao ?? '',
          label: e.descricao ?? '',
          chassis: e.chassi ?? '',
          chassi: e.chassi ?? '',
          modelo: e.modelo ?? '',
          linha: e.linha ?? '',
          tipo: e.tipo ?? '',
          placa: e.placa ?? '',
          marca: e.marca ?? '',
          ano: e.ano ?? '',
          obra: e.obra ?? '',
          status: e.status ?? 'ativo',
          medicaoAtual: e.medicaoAtual ?? 0,
          intervaloRevisao: e.intervaloRevisao ?? 0,
          ultimaRevisao: e.ultimaRevisao ?? 0,
          unidadeRevisao: e.unidadeRevisao ?? 'h',
        }));
        return { data, message: 'Equipamentos buscados com sucesso!' };
      }

      return { data: [], message: 'Equipamentos buscados com sucesso!' };
    } catch (error) {
      console.error('Erro ao buscar equipamentos:', error);
      throw new InternalServerErrorException(
        'Não foi possível buscar os equipamentos no banco de dados.',
      );
    }
  }

  /**
   * Equipamentos da prefeitura em que o funcionário é condutor responsável.
   * Alimenta o seletor de veículo do PWA FleetFuel (motorista).
   */
  async findEquipamentosByMotorista(
    prefeituraId: string,
    motoristaId: string,
  ) {
    try {
      const companyId = await resolverCompanyId(this.prisma, prefeituraId);
      if (!companyId) {
        return { data: [], message: 'Equipamentos do condutor buscados com sucesso!' };
      }

      const rows = await this.prisma.equipment.findMany({
        where: { companyId },
        select: {
          id: true,
          legacyId: true,
          descricao: true,
          chassi: true,
          modelo: true,
          linha: true,
          tipo: true,
          placa: true,
          marca: true,
          ano: true,
          obra: true,
          status: true,
          medicaoAtual: true,
          intervaloRevisao: true,
          ultimaRevisao: true,
          unidadeRevisao: true,
          combustivel: true,
          capacidadeTanque: true,
          condutoresIds: true,
        },
      });

      const equipamentos = rows
        .filter(
          (e) =>
            !ehComboioTipo(e.tipo) &&
            ehCondutorDoEquipamentoRow(e, motoristaId),
        )
        .map((e) => mapEquipmentToApi(e, prefeituraId));

      const data = equipamentos.map((e) => {
        const nome =
          txt(e.descricao) || txt(e.modelo) || txt(e.tipo) || 'Equipamento';
        return {
          id: e.id,
          descricao: nome,
          placa: txt(e.placa),
          chassis: txt(e.chassis),
          tipo: txt(e.tipo),
        };
      });

      return {
        data,
        message: 'Equipamentos do condutor buscados com sucesso!',
      };
    } catch (error) {
      console.error('Erro ao buscar equipamentos do condutor:', error);
      throw new InternalServerErrorException(
        'Não foi possível buscar os equipamentos do condutor.',
      );
    }
  }

  /**
   * Comboios (equipamentos `tipo: Comboio`) da prefeitura em que o funcionário
   * é condutor responsável — com o tanque resolvido. Alimenta o seletor de
   * comboio do PWA do comboista (cada turno escolhe qual comboio opera).
   */
  async findComboiosByMotorista(prefeituraId: string, motoristaId: string) {
    try {
      const companyId = await resolverCompanyId(this.prisma, prefeituraId);
      if (!companyId) {
        return { data: [], message: 'Comboios do condutor buscados com sucesso!' };
      }

      const rows = await this.prisma.equipment.findMany({
        where: { companyId },
        select: {
          id: true,
          legacyId: true,
          descricao: true,
          chassi: true,
          modelo: true,
          tipo: true,
          placa: true,
          combustivel: true,
          capacidadeTanque: true,
          volumeTanqueAtual: true,
          condutoresIds: true,
        },
      });

      const data = rows
        .filter(
          (e) =>
            ehComboioTipo(e.tipo) &&
            ehCondutorDoEquipamentoRow(e, motoristaId),
        )
        .map((e) => {
          const comboioId = e.legacyId ?? e.id;
          const capacity = nmr(e.capacidadeTanque);
          const currentVolume = nmr(e.volumeTanqueAtual);
          const { percentage, status } = tankStatusPg(capacity, currentVolume);
          const nome = txt(e.descricao) || txt(e.modelo) || 'Comboio';
          return {
            id: comboioId,
            descricao: nome,
            placa: txt(e.placa),
            chassis: txt(e.chassi),
            tank: {
              name: nome,
              fuelType: txt(e.combustivel),
              capacity,
              currentVolume,
              percentage,
              status,
              veiculoModelo: txt(e.modelo) || txt(e.descricao),
              veiculoPlaca: txt(e.placa),
            },
          };
        });

      return { data, message: 'Comboios do condutor buscados com sucesso!' };
    } catch (error) {
      console.error('Erro ao buscar comboios do condutor:', error);
      throw new InternalServerErrorException(
        'Não foi possível buscar os comboios do condutor.',
      );
    }
  }

  async updateById(id: string, dto: UpdateEquipamentoDto) {
    try {
      const row = await this.prisma.equipment.findFirst({
        where: { OR: [{ id }, { legacyId: id }] },
      });
      if (!row) {
        throw new NotFoundException(
          'Equipamento não encontrado para o ID fornecido.',
        );
      }

      const patch = mapUpdateEquipamentoToPrisma(dto);
      if (Object.keys(patch).length === 0) {
        return { data: {}, message: 'Equipamento atualizado com sucesso!' };
      }

      const updated = await this.prisma.equipment.update({
        where: { id: row.id },
        data: patch,
      });

      if (ehComboioTipo(updated.tipo)) {
        await ensureTankForComboioPg(this.prisma, row.id);
      }

      return { data: {}, message: 'Equipamento atualizado com sucesso!' };
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      console.error('Erro ao atualizar equipamento:', error);
      throw new InternalServerErrorException(
        'Não foi possível atualizar o equipamento no banco de dados.',
      );
    }
  }

  /**
   * Atualiza `medicaoAtual` do equipamento quando o checklist informa horímetro
   * ou KM maior que a leitura cadastrada. Falhas são logadas e não propagadas —
   * o checklist já foi salvo.
   */
  async syncMedicaoFromChecklist(
    equipamentoId: string,
    campos: MedicaoChecklistTexto,
  ): Promise<boolean> {
    const id = equipamentoId.trim();
    if (!id) return false;

    const leituraTexto = (campos.hourMeter ?? campos.km ?? '').trim();
    if (!leituraTexto) return false;

    const prismaOk = await this.syncMedicaoPrisma(id, leituraTexto);
    return prismaOk;
  }

  private async syncMedicaoPrisma(
    id: string,
    leituraTexto: string,
  ): Promise<boolean> {
    try {
      const equip = await this.prisma.equipment.findFirst({
        where: { OR: [{ id }, { legacyId: id }] },
        select: { id: true, medicaoAtual: true, unidadeRevisao: true },
      });
      if (!equip) return false;

      const resolvido = resolverLeituraParaUnidade(
        leituraTexto,
        equip.unidadeRevisao,
      );
      if (!resolvido) return false;
      if (
        !deveAplicarMedicaoChecklist(
          {
            unidadeRevisao: equip.unidadeRevisao,
            medicaoAtual: equip.medicaoAtual,
          },
          resolvido.measurementType,
          resolvido.leitura,
        )
      ) {
        return false;
      }

      await this.prisma.equipment.update({
        where: { id: equip.id },
        data: { medicaoAtual: resolvido.leitura },
      });
      return true;
    } catch (error) {
      console.warn(
        'Não foi possível sincronizar medição do equipamento (Postgres):',
        { equipamentoId: id, error },
      );
      return false;
    }
  }

  async deleteById(id: string) {
    try {
      const row = await this.prisma.equipment.findFirst({
        where: { OR: [{ id }, { legacyId: id }] },
      });
      if (!row) {
        throw new NotFoundException(
          'Equipamento não encontrado para o ID fornecido.',
        );
      }
      // Lápide e remoção na mesma transação. Apagar sem registrar deixaria o
      // equipamento para sempre no tablet do operador: o cursor do /sync/pull
      // enxerga criação e edição, nunca o que sumiu.
      await this.prisma.$transaction([
        this.prisma.syncTombstone.create({
          data: {
            colecao: 'equipamentos',
            // Mesmo id que o app recebeu no pull.
            registroId: row.legacyId ?? row.id,
            companyId: row.companyId,
          },
        }),
        this.prisma.equipment.delete({ where: { id: row.id } }),
      ]);
      return { data: {}, message: 'Equipamento removido com sucesso!' };
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      console.error('Erro ao remover equipamento:', error);
      throw new InternalServerErrorException(
        'Não foi possível remover o equipamento no banco de dados.',
      );
    }
  }

  /**
   * Registra uma revisão concluída e libera o equipamento: grava a revisão no
   * histórico, adota a leitura informada como leitura atual e base da próxima
   * revisão, e devolve o equipamento para o status "ativo".
   */
  async completeRevision(dto: CompleteRevisaoEquipDto) {
    const revisionId = randomUUID();
    try {
      const equip = await this.prisma.equipment.findFirst({
        where: {
          OR: [{ id: dto.equipamentoId }, { legacyId: dto.equipamentoId }],
        },
        select: {
          id: true,
          legacyId: true,
          medicaoAtual: true,
          unidadeRevisao: true,
        },
      });
      if (!equip) {
        throw new NotFoundException(
          'Equipamento não encontrado para o ID fornecido.',
        );
      }

      const medicaoAtual = equip.medicaoAtual ?? 0;
      if (dto.odometerReading < medicaoAtual) {
        throw new BadRequestException(
          'A leitura não pode ser menor que a medição atual do equipamento.',
        );
      }

      const unidade = equip.unidadeRevisao?.trim() || 'h';
      const revisionDate = new Date(dto.revisionDate);
      const createdAt = new Date();

      await this.prisma.$transaction([
        this.prisma.equipmentRevision.create({
          data: {
            id: revisionId,
            equipmentId: equip.id,
            data: revisionDate,
            leitura: dto.odometerReading,
            unidade,
            oficina: dto.mechanicOrOfficeName.trim() || null,
            custo: dto.revisionCost,
            notaFiscal: dto.invoiceNumber.trim() || null,
            servicos: dto.servicesDescription.trim() || null,
            createdAt,
          },
        }),
        this.prisma.equipment.update({
          where: { id: equip.id },
          data: {
            medicaoAtual: dto.odometerReading,
            ultimaRevisao: dto.odometerReading,
            status: 'ativo',
          },
        }),
      ]);

      const novaRevisao = {
        id: revisionId,
        revisionDate: dto.revisionDate,
        odometerReading: dto.odometerReading,
        mechanicOrOfficeName: dto.mechanicOrOfficeName,
        servicesDescription: dto.servicesDescription,
        revisionCost: dto.revisionCost,
        invoiceNumber: dto.invoiceNumber,
        prefeituraId: dto.prefeituraId,
        equipamentoId: equip.legacyId ?? equip.id,
        status: 'Concluída',
        createdAt: createdAt.toISOString(),
      };

      return {
        data: novaRevisao,
        message: 'Revisão concluída e equipamento liberado com sucesso!',
      };
    } catch (error) {
      if (
        error instanceof BadRequestException ||
        error instanceof NotFoundException
      ) {
        throw error;
      }
      console.error('Erro ao concluir revisão do equipamento:', error);
      throw new InternalServerErrorException(
        'Não foi possível concluir a revisão. Tente novamente mais tarde.',
      );
    }
  }
}
