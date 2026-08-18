import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import {
  mapLancamentoFromRow,
  mapStatusFromApi,
  mapTipoFromApi,
  parseVencimento,
} from '../../common/prisma/financeiro-prisma.mapper';
import type { FinanceiroOverview } from './financeiro.types';
import { CreateLancamentoDto } from './dto/create-lancamento.dto';

const STATUS = ['pago', 'pendente', 'atrasado'] as const;

function texto(valor: unknown): string {
  return typeof valor === 'string' ? valor : '';
}

function numero(valor: unknown): number {
  if (typeof valor === 'number') return Number.isFinite(valor) ? valor : 0;
  if (typeof valor === 'string') {
    const limpo = valor
      .replace(/[^0-9,.-]/g, '')
      .replace(/\./g, '')
      .replace(',', '.');
    const n = Number(limpo);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

@Injectable()
export class FinanceiroService {
  constructor(private readonly prisma: PrismaService) {}

  async listar(): Promise<{ data: FinanceiroOverview }> {
    try {
      const rows = await this.prisma.lancamentoFinanceiro.findMany({
        orderBy: { numero: 'asc' },
      });

      const lancamentos = rows.map(mapLancamentoFromRow);

      const receitas = lancamentos
        .filter((l) => l.tipo === 'receita')
        .reduce((s, l) => s + l.valor, 0);
      const despesas = lancamentos
        .filter((l) => l.tipo === 'despesa')
        .reduce((s, l) => s + l.valor, 0);

      return {
        data: {
          lancamentos,
          resumo: {
            receitas,
            despesas,
            saldo: receitas - despesas,
            total: lancamentos.length,
          },
        },
      };
    } catch (error) {
      console.error('Erro ao listar lançamentos:', error);
      throw new InternalServerErrorException(
        'Não foi possível carregar o financeiro.',
      );
    }
  }

  async criar(dto: CreateLancamentoDto) {
    const descricao = (dto.descricao ?? '').trim();
    const valor = numero(dto.valor);
    const tipo = mapTipoFromApi(dto.tipo === 'despesa' ? 'despesa' : 'receita');
    const status = STATUS.includes(dto.status as (typeof STATUS)[number])
      ? mapStatusFromApi(dto.status as (typeof STATUS)[number])
      : mapStatusFromApi('pendente');

    if (!descricao) {
      throw new BadRequestException('Informe a descrição do lançamento.');
    }
    if (!(valor > 0)) {
      throw new BadRequestException('Informe um valor maior que zero.');
    }

    try {
      const last = await this.prisma.lancamentoFinanceiro.findFirst({
        orderBy: { numero: 'desc' },
        select: { numero: true },
      });
      const nextNumero = Math.max(1000, last?.numero ?? 1000) + 1;
      const id = randomUUID();

      await this.prisma.lancamentoFinanceiro.create({
        data: {
          id,
          numero: nextNumero,
          tipo,
          descricao,
          valor: valor.toFixed(2),
          vencimento: parseVencimento(texto(dto.vencimento)),
          status,
        },
      });

      return {
        data: { id, documento: `FI-${nextNumero}` },
        message: 'Lançamento criado.',
      };
    } catch (error) {
      console.error('Erro ao salvar lançamento:', error);
      throw new InternalServerErrorException(
        'Não foi possível salvar o lançamento.',
      );
    }
  }

  async remover(id: string) {
    if (!id) throw new BadRequestException('ID inválido.');
    try {
      const row = await this.prisma.lancamentoFinanceiro.findUnique({
        where: { id },
      });
      if (!row) {
        return { message: 'Lançamento removido.' };
      }
      await this.prisma.lancamentoFinanceiro.delete({
        where: { id: row.id },
      });
      return { message: 'Lançamento removido.' };
    } catch (error) {
      console.error('Erro ao remover lançamento:', error);
      throw new InternalServerErrorException(
        'Não foi possível remover o lançamento.',
      );
    }
  }
}
