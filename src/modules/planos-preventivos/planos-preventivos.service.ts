import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '../../prisma/generated/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  resolverCompanyId,
  resolverEmpresa,
} from '../../common/prisma/company-resolver';
import { clonarMatrizPadrao } from './data/matriz-padrao.seed';
import { validarMatrizPreventiva } from './helpers/validar-matriz.helper';
import type {
  CategoriaPlano,
  CicloMatriz,
  LinhaMatriz,
  PlanoPreventivoDoc,
  SalvarPlanoPreventivoInput,
} from './planos-preventivos.types';

function toInputJson(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

@Injectable()
export class PlanosPreventivosService {
  constructor(private readonly prisma: PrismaService) {}

  async obter(prefeituraId: string): Promise<{ data: PlanoPreventivoDoc; message: string }> {
    const id = prefeituraId.trim();
    await this.assertClienteExiste(id);

    const companyId = await resolverCompanyId(this.prisma, id);
    if (!companyId) {
      throw new NotFoundException('Preventive plan not found for this municipality.');
    }

    const row = await this.prisma.planoPreventivo.findUnique({
      where: { companyId },
    });
    if (!row) {
      throw new NotFoundException('Preventive plan not found for this municipality.');
    }

    return {
      data: this.mapRow(id, row.categorias, row.updatedAt),
      message: 'Preventive plan loaded.',
    };
  }

  async salvar(
    prefeituraId: string,
    body: unknown,
  ): Promise<{ data: PlanoPreventivoDoc; message: string }> {
    const id = prefeituraId.trim();
    await this.assertClienteExiste(id);
    const matriz = validarMatrizPreventiva(body);

    try {
      const doc = await this.gravar(id, matriz);
      return { data: doc, message: 'Preventive plan saved.' };
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      console.error('Erro ao salvar plano preventivo:', error);
      throw new InternalServerErrorException('Could not save preventive plan.');
    }
  }

  async restaurarPadrao(
    prefeituraId: string,
  ): Promise<{ data: PlanoPreventivoDoc; message: string }> {
    const id = prefeituraId.trim();
    await this.assertClienteExiste(id);

    try {
      const doc = await this.gravar(id, clonarMatrizPadrao());
      return { data: doc, message: 'Default preventive plan restored.' };
    } catch (error) {
      console.error('Erro ao restaurar plano preventivo:', error);
      throw new InternalServerErrorException('Could not restore default preventive plan.');
    }
  }

  private async gravar(
    prefeituraId: string,
    matriz: SalvarPlanoPreventivoInput,
  ): Promise<PlanoPreventivoDoc> {
    const companyId = await resolverCompanyId(this.prisma, prefeituraId);
    if (!companyId) {
      throw new NotFoundException('Cliente (prefeitura) não encontrado.');
    }

    const row = await this.prisma.planoPreventivo.upsert({
      where: { companyId },
      update: { categorias: toInputJson(matriz.categorias) },
      create: {
        companyId,
        categorias: toInputJson(matriz.categorias),
      },
    });

    return this.mapRow(prefeituraId, row.categorias, row.updatedAt);
  }

  private mapRow(
    prefeituraId: string,
    categoriasRaw: unknown,
    updatedAt: Date,
  ): PlanoPreventivoDoc {
    const raw: Record<string, unknown> = Array.isArray(categoriasRaw)
      ? { categorias: categoriasRaw }
      : categoriasRaw && typeof categoriasRaw === 'object'
        ? (categoriasRaw as Record<string, unknown>)
        : { categorias: [] };

    return {
      prefeituraId,
      categorias: this.normalizarCategorias(raw),
      atualizadoEm: updatedAt.toISOString(),
    };
  }

  /** Aceita formato novo (matriz na categoria) ou legado (ciclos/linhas no root). */
  private normalizarCategorias(raw: Record<string, unknown>): CategoriaPlano[] {
    const seed = clonarMatrizPadrao().categorias;

    if (Array.isArray(raw.categorias) && raw.categorias.length > 0) {
      const primeira = raw.categorias[0] as Record<string, unknown>;
      if (Array.isArray(primeira?.ciclos) && Array.isArray(primeira?.linhas)) {
        const cats: CategoriaPlano[] = [];
        for (const item of raw.categorias) {
          if (!item || typeof item !== 'object') continue;
          const c = item as Record<string, unknown>;
          const id = typeof c.id === 'string' ? c.id.trim() : '';
          const nome = typeof c.nome === 'string' ? c.nome.trim() : '';
          if (!id || !nome) continue;
          cats.push({
            id,
            nome,
            ciclos: Array.isArray(c.ciclos) ? (c.ciclos as CicloMatriz[]) : [],
            linhas: this.mapLinhas(c.linhas),
          });
        }
        if (cats.length > 0) return cats;
      }

      // Legado: categorias {id,nome} + root ciclos/linhas
      const ciclosRoot = Array.isArray(raw.ciclos)
        ? (raw.ciclos as CicloMatriz[])
        : seed[0]?.ciclos ?? [];
      const linhasRoot = this.mapLinhasLegado(raw.linhas);
      const meta = (raw.categorias as Array<Record<string, unknown>>)
        .map((c) => ({
          id: typeof c.id === 'string' ? c.id.trim() : '',
          nome: typeof c.nome === 'string' ? c.nome.trim() : '',
        }))
        .filter((c) => c.id && c.nome);

      if (meta.length > 0) {
        return meta.map((m) => {
          const key = m.nome.toLocaleLowerCase('pt-BR');
          return {
            id: m.id,
            nome: m.nome,
            ciclos: JSON.parse(JSON.stringify(ciclosRoot)) as CicloMatriz[],
            linhas: linhasRoot
              .filter((l) => l.categoriaKey === key)
              .map(({ categoriaKey: _, ...rest }) => rest),
          };
        });
      }
    }

    if (Array.isArray(raw.linhas) && raw.linhas.length > 0) {
      const ciclosRoot = Array.isArray(raw.ciclos)
        ? (raw.ciclos as CicloMatriz[])
        : seed[0]?.ciclos ?? [];
      const linhasRoot = this.mapLinhasLegado(raw.linhas);
      const ordem: string[] = [];
      const grupos = new Map<string, LinhaMatriz[]>();
      for (const l of linhasRoot) {
        const nome = l.categoriaNome || 'Geral';
        const key = l.categoriaKey;
        if (!grupos.has(key)) {
          grupos.set(key, []);
          ordem.push(nome);
        }
        grupos.get(key)!.push({
          id: l.id,
          item: l.item,
          especificacao: l.especificacao,
          acoes: l.acoes,
        });
      }
      return ordem.map((nome, i) => {
        const key = nome.toLocaleLowerCase('pt-BR');
        return {
          id: `cat-${key.replace(/\s+/g, '-').slice(0, 40)}-${i + 1}`,
          nome,
          ciclos: JSON.parse(JSON.stringify(ciclosRoot)) as CicloMatriz[],
          linhas: grupos.get(key) ?? [],
        };
      });
    }

    return seed;
  }

  private mapLinhas(raw: unknown): LinhaMatriz[] {
    if (!Array.isArray(raw)) return [];
    return raw
      .filter((item): item is Record<string, unknown> => !!item && typeof item === 'object')
      .map((l, i) => ({
        id: typeof l.id === 'string' && l.id.trim() ? l.id.trim() : `l${i + 1}`,
        item: typeof l.item === 'string' ? l.item : '',
        especificacao: typeof l.especificacao === 'string' ? l.especificacao : '',
        acoes:
          l.acoes && typeof l.acoes === 'object' && !Array.isArray(l.acoes)
            ? (l.acoes as LinhaMatriz['acoes'])
            : {},
      }));
  }

  private mapLinhasLegado(raw: unknown): Array<
    LinhaMatriz & { categoriaKey: string; categoriaNome: string }
  > {
    if (!Array.isArray(raw)) return [];
    return raw
      .filter((item): item is Record<string, unknown> => !!item && typeof item === 'object')
      .map((l, i) => {
        const cat =
          typeof l.categoria === 'string' && l.categoria.trim()
            ? l.categoria.trim()
            : 'Geral';
        return {
          id: typeof l.id === 'string' && l.id.trim() ? l.id.trim() : `l${i + 1}`,
          item: typeof l.item === 'string' ? l.item : '',
          especificacao: typeof l.especificacao === 'string' ? l.especificacao : '',
          acoes:
            l.acoes && typeof l.acoes === 'object' && !Array.isArray(l.acoes)
              ? (l.acoes as LinhaMatriz['acoes'])
              : {},
          categoriaNome: cat,
          categoriaKey: cat.toLocaleLowerCase('pt-BR'),
        };
      });
  }

  private async assertClienteExiste(prefeituraId: string): Promise<void> {
    const id = prefeituraId.trim();
    if (!id) throw new BadRequestException('prefeituraId inválido.');

    const company = await resolverEmpresa(this.prisma, id, { id: true });
    if (!company) {
      throw new NotFoundException('Cliente (prefeitura) não encontrado.');
    }
  }
}
