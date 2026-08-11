import { BadRequestException } from '@nestjs/common';
import {
  ACOES_MATRIZ,
  type AcaoMatriz,
  type CategoriaPlano,
  type CicloMatriz,
  type LinhaMatriz,
  type SalvarPlanoPreventivoInput,
} from '../planos-preventivos.types';

function texto(valor: unknown): string {
  return typeof valor === 'string' ? valor.trim() : '';
}

function numero(valor: unknown): number | null {
  if (typeof valor === 'number' && Number.isFinite(valor)) return valor;
  if (typeof valor === 'string' && valor.trim() !== '') {
    const n = Number(valor);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function ehAcaoMatriz(valor: string): valor is AcaoMatriz {
  return (ACOES_MATRIZ as readonly string[]).includes(valor);
}

function validarCiclos(
  raw: unknown,
  contexto: string,
): CicloMatriz[] {
  if (!Array.isArray(raw) || raw.length < 1) {
    throw new BadRequestException(`${contexto}: informe ao menos um ciclo.`);
  }

  const ciclosIds = new Set<string>();
  return raw.map((item, index) => {
    if (!item || typeof item !== 'object') {
      throw new BadRequestException(`${contexto}: ciclo inválido na posição ${index}.`);
    }
    const c = item as Record<string, unknown>;
    const id = texto(c.id);
    if (!id) {
      throw new BadRequestException(`${contexto}: ciclo na posição ${index} sem id.`);
    }
    if (ciclosIds.has(id)) {
      throw new BadRequestException(`${contexto}: ciclo duplicado: ${id}.`);
    }
    ciclosIds.add(id);

    const horas = numero(c.horas);
    const km = numero(c.km);
    if (horas === null || horas < 0) {
      throw new BadRequestException(`${contexto}: ciclo ${id}: horas inválidas.`);
    }
    if (km === null || km < 0) {
      throw new BadRequestException(`${contexto}: ciclo ${id}: km inválidos.`);
    }

    return { id, horas, km, titulo: texto(c.titulo) };
  });
}

function validarLinhas(
  raw: unknown,
  ciclosIds: Set<string>,
  contexto: string,
): LinhaMatriz[] {
  if (!Array.isArray(raw)) {
    throw new BadRequestException(`${contexto}: linhas inválidas.`);
  }

  return raw.map((item, index) => {
    if (!item || typeof item !== 'object') {
      throw new BadRequestException(`${contexto}: linha inválida na posição ${index}.`);
    }
    const l = item as Record<string, unknown>;
    const id = texto(l.id);
    if (!id) {
      throw new BadRequestException(`${contexto}: linha na posição ${index} sem id.`);
    }

    const acoesRaw = l.acoes;
    if (!acoesRaw || typeof acoesRaw !== 'object' || Array.isArray(acoesRaw)) {
      throw new BadRequestException(`${contexto}: linha ${id}: acoes inválidas.`);
    }

    const acoes: Record<string, AcaoMatriz> = {};
    for (const [cicloId, acao] of Object.entries(
      acoesRaw as Record<string, unknown>,
    )) {
      if (!ciclosIds.has(cicloId)) {
        throw new BadRequestException(
          `${contexto}: linha ${id}: ação referencia ciclo inexistente (${cicloId}).`,
        );
      }
      const acaoStr = texto(acao);
      if (!ehAcaoMatriz(acaoStr)) {
        throw new BadRequestException(
          `${contexto}: linha ${id}, ciclo ${cicloId}: ação "${acaoStr}" inválida.`,
        );
      }
      acoes[cicloId] = acaoStr;
    }

    return {
      id,
      item: texto(l.item),
      especificacao: texto(l.especificacao),
      acoes,
    };
  });
}

export function validarMatrizPreventiva(input: unknown): SalvarPlanoPreventivoInput {
  if (!input || typeof input !== 'object') {
    throw new BadRequestException('Body inválido: envie { categorias }.');
  }

  const raw = input as Record<string, unknown>;

  // Aceita formato novo; rejeita legado plano (ciclos/linhas no root sem matrizes nas cats)
  if (!Array.isArray(raw.categorias) || raw.categorias.length < 1) {
    throw new BadRequestException('Informe ao menos uma categoria com matriz.');
  }

  const ids = new Set<string>();
  const nomes = new Set<string>();
  const categorias: CategoriaPlano[] = [];

  raw.categorias.forEach((item, index) => {
    if (!item || typeof item !== 'object') {
      throw new BadRequestException(`Categoria inválida na posição ${index}.`);
    }
    const c = item as Record<string, unknown>;
    const id = texto(c.id);
    const nome = texto(c.nome);
    if (!id) {
      throw new BadRequestException(`Categoria na posição ${index} sem id.`);
    }
    if (!nome) {
      throw new BadRequestException(`Categoria ${id}: nome obrigatório.`);
    }
    if (ids.has(id)) {
      throw new BadRequestException(`Categoria duplicada: ${id}.`);
    }
    const nomeKey = nome.toLocaleLowerCase('pt-BR');
    if (nomes.has(nomeKey)) {
      throw new BadRequestException(`Nome de categoria duplicado: ${nome}.`);
    }
    ids.add(id);
    nomes.add(nomeKey);

    const ctx = `Categoria "${nome}"`;
    const ciclos = validarCiclos(c.ciclos, ctx);
    const ciclosIds = new Set(ciclos.map((x) => x.id));
    const linhas = validarLinhas(c.linhas, ciclosIds, ctx);

    categorias.push({ id, nome, ciclos, linhas });
  });

  return { categorias };
}
