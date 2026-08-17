import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import { resolverCompanyId } from '../../common/prisma/company-resolver';
import { PrismaService } from '../../prisma/prisma.service';
import type {
  ChecklistRegistroDoc,
  ChecklistRegistroResumoPainel,
  TopOperadorChecklist,
} from './checklists-registros.types';
import { mapChecklistRunRowToDoc } from './helpers/checklists-registros.mapper';
import {
  calcularChecklistsPorSemana,
  calcularTopOperadores,
  filtrarChecklistsPorMes,
} from './helpers/top-operadores.helper';

function texto(valor: unknown): string {
  return typeof valor === 'string' ? valor.trim() : '';
}

function mesAtualIso(): string {
  const agora = new Date();
  return `${agora.getFullYear()}-${String(agora.getMonth() + 1).padStart(2, '0')}`;
}

@Injectable()
export class ChecklistsRegistrosService {
  constructor(private readonly prisma: PrismaService) {}

  private async listarDocsPorPrefeitura(
    prefeituraId: string,
  ): Promise<ChecklistRegistroDoc[]> {
    const id = texto(prefeituraId);
    if (!id) {
      throw new BadRequestException('prefeituraId inválido.');
    }

    try {
      const companyId = await resolverCompanyId(this.prisma, prefeituraId);
      if (!companyId) return [];

      const rows = await this.prisma.checklistRun.findMany({
        where: { companyId },
        orderBy: [{ executedAt: 'desc' }, { createdAt: 'desc' }],
      });

      return rows.map((row) => mapChecklistRunRowToDoc(row, prefeituraId));
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      console.error('Erro ao listar checklists de operador:', error);
      throw new InternalServerErrorException(
        'Não foi possível listar os checklists de operador.',
      );
    }
  }

  async listarPorPrefeitura(
    prefeituraId: string,
  ): Promise<{ data: ChecklistRegistroDoc[]; message: string }> {
    const data = await this.listarDocsPorPrefeitura(prefeituraId);
    return {
      data,
      message: 'Checklists de operador carregados com sucesso.',
    };
  }

  async topOperadores(
    prefeituraId: string,
    mes?: string,
    limite = 5,
  ): Promise<{
    data: { mes: string; operadores: TopOperadorChecklist[] };
    message: string;
  }> {
    const mesRef = texto(mes) || mesAtualIso();
    const registros = await this.listarDocsPorPrefeitura(prefeituraId);
    const noMes = filtrarChecklistsPorMes(registros, mesRef);
    const operadores = calcularTopOperadores(noMes, limite);

    return {
      data: { mes: mesRef, operadores },
      message: 'Ranking de operadores carregado com sucesso.',
    };
  }

  async resumoPainel(
    prefeituraId: string,
    mes?: string,
  ): Promise<{ data: ChecklistRegistroResumoPainel; message: string }> {
    const mesRef = texto(mes) || mesAtualIso();
    const registros = await this.listarDocsPorPrefeitura(prefeituraId);
    const noMes = filtrarChecklistsPorMes(registros, mesRef);

    return {
      data: {
        mes: mesRef,
        totalGeral: registros.length,
        totalNoMes: noMes.length,
        checklistsPorSemana: calcularChecklistsPorSemana(noMes),
        topOperadores: calcularTopOperadores(noMes, 5),
      },
      message: 'Resumo de checklists do painel carregado com sucesso.',
    };
  }
}
