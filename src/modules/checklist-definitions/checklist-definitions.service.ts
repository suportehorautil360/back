import {
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { ChecklistDefinition } from '../../prisma/generated/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateChecklistDefinitionDto } from './dto/create-checklist-definition.dto';
import { UpdateChecklistDefinitionDto } from './dto/update-checklist-definition.dto';
import { SEED_CHECKLIST_DEFINITIONS } from './seed-data';

export interface ChecklistDefinitionDoc {
  id: string;
  nome: string;
  categoria: string;
  keywords: string[];
  ativo: boolean;
  version: number;
  itens: { ordem: number; texto: string; severidade: string }[];
  createdAt: string;
  updatedAt: string;
}

/** Descarta prototype/métodos do DTO — Prisma Json exige plain literals. */
function toPlainItem(i: {
  ordem: number;
  texto: string;
  severidade: string;
}) {
  return { ordem: i.ordem, texto: i.texto, severidade: i.severidade };
}

/**
 * Catálogo GLOBAL de definições de checklist do operador. Migrado de
 * `checklistDefinitions` no Firestore em 2026-08-16 (purge Firebase). O
 * modelo Postgres (`checklist_definitions`) é 1:1 com o antigo — `id` UUID
 * novo + `legacyId` (o slug/docId antigo pra preservar refs em `runs` e
 * caches offline). Shape da API mantido pro PWA/painel não precisarem mudar.
 */
@Injectable()
export class ChecklistDefinitionsService {
  private readonly logger = new Logger(ChecklistDefinitionsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Serializa a linha Postgres pro shape que o front espera (Json → string[] etc). */
  private toDoc(row: ChecklistDefinition): ChecklistDefinitionDoc {
    return {
      // Front usa `id` como slug canônico — preserva `legacyId` quando existe
      // (seed usa slug); senão UUID novo. Caches offline gravaram slug.
      id: row.legacyId ?? row.id,
      nome: row.nome,
      categoria: row.categoria,
      keywords: Array.isArray(row.keywords) ? (row.keywords as string[]) : [],
      ativo: row.ativo,
      version: row.version,
      itens: Array.isArray(row.itens)
        ? (row.itens as ChecklistDefinitionDoc['itens'])
        : [],
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  /**
   * Localiza por `legacyId` (slug do seed / docId Firestore) OU pelo UUID
   * Postgres — front pode passar qualquer um dos dois. Ordem: legacyId
   * primeiro porque é o mais comum vindo de caches antigos.
   */
  private async findByAnyId(
    id: string,
  ): Promise<ChecklistDefinition> {
    const porLegacy = await this.prisma.checklistDefinition.findUnique({
      where: { legacyId: id },
    });
    if (porLegacy) return porLegacy;

    const isUuid =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
    if (isUuid) {
      const porId = await this.prisma.checklistDefinition.findUnique({
        where: { id },
      });
      if (porId) return porId;
    }

    throw new NotFoundException('Definição de checklist não encontrada.');
  }

  async create(dto: CreateChecklistDefinitionDto) {
    try {
      const criada = await this.prisma.checklistDefinition.create({
        data: {
          nome: dto.nome,
          categoria: dto.categoria,
          keywords: Array.isArray(dto.keywords) ? dto.keywords : [],
          ativo: dto.ativo ?? true,
          version: 1,
          // DTO instances têm prototype de classe — Prisma InputJsonValue exige
          // plain object literals. Map explícito garante o shape correto.
          itens: Array.isArray(dto.itens) ? dto.itens.map(toPlainItem) : [],
        },
      });
      return {
        data: this.toDoc(criada),
        message: 'Definição de checklist criada!',
      };
    } catch (error) {
      this.logger.error(
        JSON.stringify({
          evento: 'checklist-def-create',
          erro: (error as Error).message,
        }),
      );
      throw new InternalServerErrorException(
        'Não foi possível salvar a definição de checklist.',
      );
    }
  }

  /** Lista o catálogo. `somenteAtivas=true` filtra por `ativo=true`. */
  async findAll(somenteAtivas = false) {
    try {
      const linhas = await this.prisma.checklistDefinition.findMany({
        where: somenteAtivas ? { ativo: true } : undefined,
        orderBy: { nome: 'asc' },
      });
      return {
        data: linhas.map((l) => this.toDoc(l)),
        message: 'Definições de checklist listadas.',
      };
    } catch (error) {
      this.logger.error(
        JSON.stringify({
          evento: 'checklist-def-list',
          erro: (error as Error).message,
        }),
      );
      throw new InternalServerErrorException(
        'Não foi possível listar as definições de checklist.',
      );
    }
  }

  async findById(id: string) {
    const row = await this.findByAnyId(id);
    return { data: this.toDoc(row), message: 'Definição encontrada.' };
  }

  async updateById(id: string, dto: UpdateChecklistDefinitionDto) {
    try {
      const atual = await this.findByAnyId(id);

      const patch: Parameters<
        typeof this.prisma.checklistDefinition.update
      >[0]['data'] = {};
      if (dto.nome !== undefined) patch.nome = dto.nome;
      if (dto.categoria !== undefined) patch.categoria = dto.categoria;
      if (dto.keywords !== undefined) patch.keywords = dto.keywords;
      if (dto.ativo !== undefined) patch.ativo = dto.ativo;
      if (dto.itens !== undefined) {
        patch.itens = dto.itens.map(toPlainItem);
        // Version bump só quando itens mudam — invalida cache do operador.
        patch.version = atual.version + 1;
      }

      const atualizado = await this.prisma.checklistDefinition.update({
        where: { id: atual.id },
        data: patch,
      });
      return {
        data: this.toDoc(atualizado),
        message: 'Definição de checklist atualizada!',
      };
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      this.logger.error(
        JSON.stringify({
          evento: 'checklist-def-update',
          id,
          erro: (error as Error).message,
        }),
      );
      throw new InternalServerErrorException(
        'Não foi possível atualizar a definição de checklist.',
      );
    }
  }

  /**
   * Soft-delete: só marca `ativo=false`. Preserva `runs` históricos que
   * referenciam a definição por `definitionId`/`legacyId`.
   */
  async deleteById(id: string) {
    try {
      const atual = await this.findByAnyId(id);
      await this.prisma.checklistDefinition.update({
        where: { id: atual.id },
        data: { ativo: false },
      });
      return {
        data: { id: atual.legacyId ?? atual.id },
        message: 'Definição de checklist desativada.',
      };
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      this.logger.error(
        JSON.stringify({
          evento: 'checklist-def-delete',
          id,
          erro: (error as Error).message,
        }),
      );
      throw new InternalServerErrorException(
        'Não foi possível desativar a definição de checklist.',
      );
    }
  }

  /**
   * Bootstrap idempotente do catálogo. Usa `legacyId=slug` como chave —
   * re-rodar não duplica. Sem `force`, no-op quando já há qualquer linha.
   */
  async seedDefaults(force = false) {
    try {
      if (!force) {
        const existe = await this.prisma.checklistDefinition.count({ take: 1 });
        if (existe > 0) {
          return {
            data: [],
            message: 'Catálogo já populado — seed ignorado (use ?force=true).',
          };
        }
      }

      const gravadas: ChecklistDefinitionDoc[] = [];
      for (const def of SEED_CHECKLIST_DEFINITIONS) {
        const existente = await this.prisma.checklistDefinition.findUnique({
          where: { legacyId: def.slug },
        });
        const version = (existente?.version ?? 0) + 1;

        const upserted = await this.prisma.checklistDefinition.upsert({
          where: { legacyId: def.slug },
          update: {
            nome: def.nome,
            categoria: def.categoria,
            keywords: def.keywords,
            itens: def.itens,
            ativo: true,
            version,
          },
          create: {
            legacyId: def.slug,
            nome: def.nome,
            categoria: def.categoria,
            keywords: def.keywords,
            itens: def.itens,
            ativo: true,
            version,
          },
        });
        gravadas.push(this.toDoc(upserted));
      }
      return {
        data: gravadas,
        message: `Seed concluído: ${gravadas.length} definições gravadas.`,
      };
    } catch (error) {
      this.logger.error(
        JSON.stringify({
          evento: 'checklist-def-seed',
          erro: (error as Error).message,
        }),
      );
      throw new InternalServerErrorException(
        'Não foi possível semear as definições de checklist.',
      );
    }
  }
}
