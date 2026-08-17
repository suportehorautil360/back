import {
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { resolverCompanyId } from '../../common/prisma/company-resolver';
import { PrismaService } from '../../prisma/prisma.service';
import type { PontoAbono } from '../../prisma/generated/client';

export interface AbonoDoc {
  id: string;
  prefeituraId: string;
  /** CPF do funcionário (só dígitos) — chave pra casar com batidas/folha. */
  funcionarioCpf: string;
  /** Nome do funcionário (denormalizado para listagem). */
  funcionarioNome: string;
  /** Data do dia abonado no formato YYYY-MM-DD (local). */
  data: string;
  /** Motivo declarado pelo operador na solicitação. */
  motivo?: string | null;
  /** ID da solicitação de abono que originou (rastreabilidade). */
  solicitacaoId?: string | null;
  createdAt: string;
}

function mapAbonoRow(row: PontoAbono, prefeituraId: string): AbonoDoc {
  return {
    id: row.legacyId ?? row.id,
    prefeituraId,
    funcionarioCpf: row.operatorCpf,
    funcionarioNome: row.operatorNome,
    data: row.data,
    motivo: row.motivo,
    solicitacaoId: row.solicitacaoId,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * Dias "abonados" — gerados quando o RH aprova uma solicitação de abono.
 */
@Injectable()
export class AbonosService {
  constructor(private readonly prisma: PrismaService) {}

  async criar(input: Omit<AbonoDoc, 'id' | 'createdAt'>): Promise<AbonoDoc> {
    const id = randomUUID();
    const companyId = await resolverCompanyId(this.prisma, input.prefeituraId);
    if (!companyId) {
      throw new InternalServerErrorException('Empresa não encontrada.');
    }

    const cpf = input.funcionarioCpf.replace(/\D/g, '');
    let operatorId: string | null = null;
    if (cpf) {
      const op = await this.prisma.operator.findFirst({
        where: { companyId, cpf },
        select: { id: true },
      });
      operatorId = op?.id ?? null;
    }

    try {
      const row = await this.prisma.pontoAbono.create({
        data: {
          id,
          legacyId: id,
          companyId,
          operatorId,
          operatorNome: input.funcionarioNome,
          operatorCpf: cpf,
          data: input.data,
          motivo: input.motivo ?? null,
          solicitacaoId: input.solicitacaoId ?? null,
        },
      });
      return mapAbonoRow(row, input.prefeituraId);
    } catch (e) {
      console.error('Erro ao criar abono:', e);
      throw new InternalServerErrorException(
        'Não foi possível registrar o abono.',
      );
    }
  }

  async listar(prefeituraId: string) {
    try {
      const companyId = await resolverCompanyId(this.prisma, prefeituraId);
      if (!companyId) {
        return { data: [] as AbonoDoc[], message: 'Abonos carregados.' };
      }

      const rows = await this.prisma.pontoAbono.findMany({
        where: { companyId },
        orderBy: { data: 'desc' },
      });
      const data = rows.map((row) => mapAbonoRow(row, prefeituraId));
      return { data, message: 'Abonos carregados.' };
    } catch (e) {
      console.error('Erro ao listar abonos:', e);
      throw new InternalServerErrorException(
        'Não foi possível listar os abonos.',
      );
    }
  }

  async remover(id: string) {
    const row = await this.prisma.pontoAbono.findFirst({
      where: { OR: [{ id }, { legacyId: id }] },
    });
    if (!row) throw new NotFoundException('Abono não encontrado.');
    await this.prisma.pontoAbono.delete({ where: { id: row.id } });
    return { data: { id: row.legacyId ?? row.id }, message: 'Abono removido.' };
  }
}
