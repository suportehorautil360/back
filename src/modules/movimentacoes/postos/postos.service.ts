import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { mapPartnerPostoToApi } from '../../../common/prisma/partner-api.mapper';
import { resolverCompanyId } from '../../../common/prisma/company-resolver';
import { PrismaService } from '../../../prisma/prisma.service';
import { parseDateEnd, parseDateStart } from '../shared/date.helper';
import { CreatePostoDto } from './dto/create-posto.dto';
import {
  AbastecimentoPostoStats,
  extractAbastecimentoValues,
  formatBRL,
  formatLitros,
  formatPrecoPorLitro,
} from './helpers/postos-list.helper';
import { PostoDoc, PostoListItem, TIPO_PARCEIRO_OPTIONS } from './postos.types';

@Injectable()
export class PostosService {
  constructor(private readonly prisma: PrismaService) {}

  async create(input: CreatePostoDto): Promise<PostoDoc> {
    if (!TIPO_PARCEIRO_OPTIONS.includes(input.tipoParceiro)) {
      throw new BadRequestException(
        'O campo tipoParceiro deve ser posto ou oficina.',
      );
    }

    const companyId = await resolverCompanyId(this.prisma, input.prefeituraId);
    if (!companyId) {
      throw new BadRequestException('Empresa não encontrada.');
    }

    const id = randomUUID();
    const prefeituraId = input.prefeituraId.trim();
    const partnerType = input.tipoParceiro === 'oficina' ? 'OFICINA' : 'POSTO';

    try {
      const partner = await this.prisma.partner.create({
        data: {
          id,
          legacyId: id,
          companyId,
          type: partnerType,
          razaoSocial: input.razaoSocial.trim(),
          nomeFantasia: input.nomeFantasia.trim(),
          cnpj: input.cnpj.trim(),
          telefonePrincipal: input.telefonePrincipal.trim(),
          emailComercial: input.emailComercial.trim(),
          cidadeUf: input.cidadeUf.trim(),
          endereco: input.endereco.trim(),
          status: 'ativo',
          ativo: true,
        },
      });

      return mapPartnerPostoToApi(partner, prefeituraId) as PostoDoc;
    } catch (error) {
      console.error('Erro ao criar posto:', error);
      throw new InternalServerErrorException(
        'Não foi possível registrar o posto.',
      );
    }
  }

  async listarPorPrefeitura(
    prefeituraId: string,
    startDate?: string,
    endDate?: string,
  ): Promise<{ data: PostoListItem[]; message: string }> {
    try {
      const startIso = startDate
        ? parseDateStart(startDate, 'startDate').toISOString()
        : undefined;
      const endIso = endDate
        ? parseDateEnd(endDate, 'endDate').toISOString()
        : undefined;

      const companyId = await resolverCompanyId(this.prisma, prefeituraId);
      if (companyId) {
        const partners = await this.prisma.partner.findMany({
          where: { companyId, type: 'POSTO' },
          orderBy: { nomeFantasia: 'asc' },
        });
        if (partners.length > 0) {
          const docs: PostoDoc[] = partners.map((p) =>
            mapPartnerPostoToApi(p, prefeituraId) as PostoDoc,
          );
          const codeMap = new Map(
            docs.map((doc, index) => [doc.id, `P${index + 1}`]),
          );
          const statsMap = await this.fetchAbastecimentoStats(
            prefeituraId,
            docs.map((doc) => doc.id),
            startIso,
            endIso,
          );
          const data = docs.map((doc) =>
            this.mapToListItem(doc, codeMap, statsMap),
          );
          return { data, message: 'Postos buscados com sucesso!' };
        }
      }

      return { data: [], message: 'Postos buscados com sucesso!' };
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      console.error('Erro ao buscar postos:', error);
      throw new InternalServerErrorException(
        'Não foi possível buscar os postos.',
      );
    }
  }

  private async fetchAbastecimentoStats(
    prefeituraId: string,
    postoIds: string[],
    startIso?: string,
    endIso?: string,
  ): Promise<Map<string, AbastecimentoPostoStats>> {
    const stats = new Map<string, AbastecimentoPostoStats>();
    for (const postoId of postoIds) {
      stats.set(postoId, {
        abastecimentos: 0,
        totalLitros: 0,
        totalGasto: 0,
        precoMedioPorLitro: null,
      });
    }

    if (postoIds.length === 0) {
      return stats;
    }

    const companyId = await resolverCompanyId(this.prisma, prefeituraId);
    if (!companyId) return stats;

    const where: {
      companyId: string;
      postoLegacyId: { in: string[] };
      createdAt?: { gte?: Date; lte?: Date };
    } = {
      companyId,
      postoLegacyId: { in: postoIds },
    };

    if (startIso) {
      where.createdAt = { ...where.createdAt, gte: new Date(startIso) };
    }
    if (endIso) {
      where.createdAt = { ...where.createdAt, lte: new Date(endIso) };
    }

    const rows = await this.prisma.abastecimento.findMany({ where });

    for (const row of rows) {
      const postoId = row.postoLegacyId ?? '';
      if (!postoId || !stats.has(postoId)) continue;

      const data = {
        liters: Number(row.litros),
        total: Number(row.valor),
        pricePerLiter: row.precoLitro != null ? Number(row.precoLitro) : null,
        createdAt: row.createdAt.toISOString(),
      };

      const { liters, gasto } = extractAbastecimentoValues(data);
      const current = stats.get(postoId)!;
      stats.set(postoId, {
        abastecimentos: current.abastecimentos + 1,
        totalLitros: current.totalLitros + liters,
        totalGasto: current.totalGasto + gasto,
        precoMedioPorLitro: null,
      });
    }

    for (const [postoId, current] of stats.entries()) {
      stats.set(postoId, {
        ...current,
        precoMedioPorLitro:
          current.totalLitros > 0
            ? current.totalGasto / current.totalLitros
            : null,
      });
    }

    return stats;
  }

  private mapToListItem(
    doc: PostoDoc,
    codeMap: Map<string, string>,
    statsMap: Map<string, AbastecimentoPostoStats>,
  ): PostoListItem {
    const stats = statsMap.get(doc.id) ?? {
      abastecimentos: 0,
      totalLitros: 0,
      totalGasto: 0,
      precoMedioPorLitro: null,
    };

    const precoPorLitro = doc.precoPorLitro ?? stats.precoMedioPorLitro ?? null;

    return {
      id: doc.id,
      code: codeMap.get(doc.id) ?? 'P?',
      name: doc.nomeFantasia,
      endereco: doc.endereco,
      precoPorLitro,
      precoPorLitroLabel: formatPrecoPorLitro(precoPorLitro),
      abastecimentos: stats.abastecimentos,
      totalLitros: stats.totalLitros,
      totalLitrosLabel: formatLitros(stats.totalLitros),
      totalGasto: stats.totalGasto,
      totalGastoLabel: formatBRL(stats.totalGasto),
      razaoSocial: doc.razaoSocial,
      cnpj: doc.cnpj,
      telefonePrincipal: doc.telefonePrincipal,
      emailComercial: doc.emailComercial,
      cidadeUf: doc.cidadeUf,
      tipoParceiro: doc.tipoParceiro,
      createdAt: doc.createdAt,
    };
  }
}
