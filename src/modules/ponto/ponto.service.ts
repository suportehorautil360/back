import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  isUuid,
  resolverCompanyId,
} from '../../common/prisma/company-resolver';
import {
  resolverLedger,
  type BatidaEfetiva,
  type RegistroPonto,
} from './ledger';

/** Teto de segurança: um mês de uma pessoa não passa perto disso. */
const LIMITE = 500;

@Injectable()
export class PontoService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Registros efetivos da pessoa no período.
   *
   * `funcionarioId` e `prefeituraId` vêm do token, nunca da query — é o que
   * impede alguém de pedir o ponto de outra pessoa.
   */
  async registrosDoPeriodo(
    funcionarioId: string,
    prefeituraId: string,
    de: Date,
    ate: Date,
  ): Promise<BatidaEfetiva[]> {
    if (Number.isNaN(de.getTime()) || Number.isNaN(ate.getTime())) {
      throw new BadRequestException('Período inválido.');
    }
    if (ate <= de) {
      throw new BadRequestException('`ate` precisa ser depois de `de`.');
    }

    const companyId = await resolverCompanyId(this.prisma, prefeituraId);
    if (!companyId) throw new NotFoundException('Empresa não encontrada.');

    // O funcionário do token é um Operator; o ledger aponta para ele por
    // operatorId quando o cadastro casou, e por CPF quando não casou.
    //
    // `funcionarioId` vem de `FuncionariosService.autenticar` como
    // `legacyId ?? id` — pode ser o UUID da PK ou um legacyId do Firestore
    // (string qualquer). Um legacyId não-UUID não pode ir para a coluna `id`,
    // que é `@db.Uuid`: o Postgres rejeita com P2007 antes mesmo de avaliar o
    // OR. Só inclui a busca por `id` quando o valor tem cara de UUID.
    const operador = await this.prisma.operator.findFirst({
      where: {
        companyId,
        ...(isUuid(funcionarioId)
          ? { OR: [{ id: funcionarioId }, { legacyId: funcionarioId }] }
          : { legacyId: funcionarioId }),
      },
      select: { id: true, cpf: true },
    });
    if (!operador)
      throw new NotFoundException('Funcionário não encontrado nesta empresa.');

    const linhas = await this.prisma.pontoRegistro.findMany({
      where: {
        companyId,
        timestampOriginal: { gte: de, lt: ate },
        OR: [
          { operatorId: operador.id },
          ...(operador.cpf ? [{ operatorCpf: operador.cpf }] : []),
        ],
      },
      orderBy: { nsr: 'asc' },
      take: LIMITE,
      select: {
        id: true,
        nsr: true,
        tipo: true,
        timestampOriginal: true,
        operatorNome: true,
        operatorCpf: true,
        registro: true,
        refNsr: true,
        refId: true,
        aplicado: true,
        motivo: true,
        motivoReprovacao: true,
        createdAt: true,
      },
    });

    const registros: RegistroPonto[] = linhas.map((l) => ({
      ...l,
      timestampOriginal: l.timestampOriginal.toISOString(),
      createdAt: l.createdAt.toISOString(),
    }));

    return resolverLedger(registros);
  }
}
