import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  mapPartnerToOficinaListItem,
} from '../../common/prisma/partner-prisma.mapper';
import type { OficinaListItem } from './oficinas.types';

@Injectable()
export class OficinasService {
  constructor(private readonly prisma: PrismaService) {}

  async listar(): Promise<{ data: OficinaListItem[]; message: string }> {
    try {
      const rows = await this.prisma.partner.findMany({
        where: { type: 'OFICINA' },
        include: {
          company: { select: { legacyId: true } },
        },
      });

      const data = rows
        .map((row) =>
          mapPartnerToOficinaListItem(
            row,
            row.company.legacyId ?? row.companyId,
          ),
        )
        .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));

      return {
        data,
        message: 'Oficinas carregadas com sucesso.',
      };
    } catch (error) {
      console.error('Erro ao listar oficinas:', error);
      throw new InternalServerErrorException(
        'Não foi possível listar as oficinas.',
      );
    }
  }
}
