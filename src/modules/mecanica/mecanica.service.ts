import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import type { PainelPayload } from '../../common/painel.guard';

/**
 * Execução interna da OS.
 *
 * Regra que atravessa o arquivo inteiro: a empresa vem SEMPRE de
 * `painel.companyId`, nunca de parâmetro da requisição, e `execucao` é sempre
 * `'interna'`. OS de pregão não existe para este módulo — nem na lista, nem
 * no detalhe, e por isso o detalhe responde 404 e não 403: 403 confirmaria a
 * existência da OS a quem não deveria saber dela.
 */
@Injectable()
export class MecanicaService {
  constructor(private readonly prisma: PrismaService) {}

  async listarBancada(painel: PainelPayload, apenasMinhas: boolean) {
    return this.prisma.serviceOrder.findMany({
      where: {
        companyId: painel.companyId,
        execucao: 'interna',
        ...(apenasMinhas
          ? { responsavelOperatorId: painel.operatorId ?? '' }
          : {}),
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async detalhe(painel: PainelPayload, osId: string) {
    const os = await this.prisma.serviceOrder.findFirst({
      where: {
        id: osId,
        companyId: painel.companyId,
        execucao: 'interna',
      },
    });
    if (!os) throw new NotFoundException('OS não encontrada.');
    return os;
  }
}
