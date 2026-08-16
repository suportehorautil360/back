import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { UpsertFeatureFlagsDto } from './dto/upsert-feature-flags.dto';

type Flags = Record<string, boolean>;

/**
 * Feature flags por empresa. Fonte da verdade: tabelas `features` (catálogo
 * global) + `company_features` (pivot). O painel `/funcionalidades` no
 * `horautil` grava aqui via Prisma; este serviço só expõe a mesma tabela pro
 * PWA legado (endpoint `GET /feature-flags/:prefeituraId`).
 *
 * Migrado de Firestore em 2026-08-16 (purge Firebase). O modelo antigo era um
 * único doc `featureFlags/{docId}` com `{prefeituraId, flags: Record<key, boolean>}`;
 * o novo é normalizado (uma linha por feature) mas a API preserva o mesmo
 * shape `{data: Record<string, boolean>, message}` pro front não precisar mudar.
 *
 * `prefeituraId` no PWA vem como `company_legacy_id` do JWT (docId Firestore
 * antigo). Aceitamos legacyId OU UUID Postgres pra tolerar as duas origens.
 */
@Injectable()
export class FeatureFlagsService {
  private readonly logger = new Logger(FeatureFlagsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Flags da empresa (objeto vazio se não houver ou empresa não encontrada). */
  async obter(prefeituraId: string): Promise<Flags> {
    try {
      const company = await this.resolverEmpresa(prefeituraId);
      if (!company) {
        this.logger.warn(
          JSON.stringify({
            evento: 'feature-flags-obter',
            prefeituraId,
            resultado: 'empresa-nao-encontrada',
          }),
        );
        return {};
      }

      const linhas = await this.prisma.companyFeature.findMany({
        where: { companyId: company.id },
        select: { enabled: true, feature: { select: { key: true } } },
      });

      const flags: Flags = {};
      for (const l of linhas) {
        if (l.feature?.key) flags[l.feature.key] = l.enabled;
      }
      return flags;
    } catch (error) {
      this.logger.error(
        JSON.stringify({
          evento: 'feature-flags-obter',
          prefeituraId,
          erro: (error as Error).message,
        }),
      );
      throw new InternalServerErrorException(
        'Não foi possível buscar as funcionalidades.',
      );
    }
  }

  /** Uma funcionalidade está ativa? (default: false / opt-in). */
  async ativo(prefeituraId: string, feature: string): Promise<boolean> {
    const flags = await this.obter(prefeituraId);
    return flags[feature] === true;
  }

  /**
   * Upsert das flags. Cada key precisa existir na tabela `features` — quem
   * cria features é o painel `/funcionalidades` no `horautil`. Se a key não
   * existir aqui, registramos warning e ignoramos (evita 500 quando o
   * catálogo Postgres está desatualizado).
   */
  async salvar(dto: UpsertFeatureFlagsDto) {
    try {
      const company = await this.resolverEmpresa(dto.prefeituraId);
      if (!company) {
        throw new InternalServerErrorException(
          `Empresa não encontrada: ${dto.prefeituraId}`,
        );
      }

      const keys = Object.keys(dto.flags);
      const features = await this.prisma.feature.findMany({
        where: { key: { in: keys } },
        select: { id: true, key: true },
      });
      const idPorKey = new Map(features.map((f) => [f.key, f.id]));

      const desconhecidas = keys.filter((k) => !idPorKey.has(k));
      if (desconhecidas.length) {
        this.logger.warn(
          JSON.stringify({
            evento: 'feature-flags-salvar',
            prefeituraId: dto.prefeituraId,
            keysIgnoradas: desconhecidas,
            motivo: 'nao-existem-no-catalogo-features',
          }),
        );
      }

      await this.prisma.$transaction(
        features.map((f) =>
          this.prisma.companyFeature.upsert({
            where: {
              companyId_featureId: { companyId: company.id, featureId: f.id },
            },
            update: { enabled: dto.flags[f.key] === true },
            create: {
              companyId: company.id,
              featureId: f.id,
              enabled: dto.flags[f.key] === true,
            },
          }),
        ),
      );

      return { data: dto.flags, message: 'Funcionalidades salvas!' };
    } catch (error) {
      if (error instanceof InternalServerErrorException) throw error;
      this.logger.error(
        JSON.stringify({
          evento: 'feature-flags-salvar',
          prefeituraId: dto.prefeituraId,
          erro: (error as Error).message,
        }),
      );
      throw new InternalServerErrorException(
        'Não foi possível salvar as funcionalidades.',
      );
    }
  }

  /**
   * Resolve `Company` por legacyId (docId Firestore antigo) ou UUID Postgres.
   * Nem `findUnique` com `legacyId` nem `id` explodem quando não achado —
   * retornamos `null` pra o caller decidir (endpoint público não vaza 404 e
   * quiet-fails com `{}`).
   */
  private async resolverEmpresa(idOuLegacy: string) {
    const isUuid =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        idOuLegacy,
      );

    if (isUuid) {
      const porId = await this.prisma.company.findUnique({
        where: { id: idOuLegacy },
        select: { id: true },
      });
      if (porId) return porId;
    }

    return this.prisma.company.findUnique({
      where: { legacyId: idOuLegacy },
      select: { id: true },
    });
  }
}
