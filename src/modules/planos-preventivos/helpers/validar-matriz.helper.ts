import { BadRequestException } from '@nestjs/common';
import { ACOES_MATRIZ, type AcaoMatriz, type SalvarPlanoPreventivoInput } from '../planos-preventivos.types';

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

export function validarMatrizPreventiva(input: unknown): SalvarPlanoPreventivoInput {
  if (!input || typeof input !== 'object') {
    throw new BadRequestException('Body inválido: envie { ciclos, linhas }.');
  }

  const raw = input as Record<string, unknown>;
  if (!Array.isArray(raw.ciclos) || !Array.isArray(raw.linhas)) {
    throw new BadRequestException('Body inválido: ciclos e linhas são obrigatórios.');
  }

  if (raw.ciclos.length < 1) {
    throw new BadRequestException('Informe ao menos um ciclo.');
  }

  const ciclosIds = new Set<string>();
  const ciclos = raw.ciclos.map((item, index) => {
    if (!item || typeof item !== 'object') {
      throw new BadRequestException(`Ciclo inválido na posição ${index}.`);
    }
    const c = item as Record<string, unknown>;
    const id = texto(c.id);
    if (!id) {
      throw new BadRequestException(`Ciclo na posição ${index} sem id.`);
    }
    if (ciclosIds.has(id)) {
      throw new BadRequestException(`Ciclo duplicado: ${id}.`);
    }
    ciclosIds.add(id);

    const horas = numero(c.horas);
    const km = numero(c.km);
    if (horas === null || horas < 0) {
      throw new BadRequestException(`Ciclo ${id}: horas inválidas.`);
    }
    if (km === null || km < 0) {
      throw new BadRequestException(`Ciclo ${id}: km inválidos.`);
    }

    return {
      id,
      horas,
      km,
      titulo: texto(c.titulo),
    };
  });

  const linhas = raw.linhas.map((item, index) => {
    if (!item || typeof item !== 'object') {
      throw new BadRequestException(`Linha inválida na posição ${index}.`);
    }
    const l = item as Record<string, unknown>;
    const id = texto(l.id);
    if (!id) {
      throw new BadRequestException(`Linha na posição ${index} sem id.`);
    }

    const acoesRaw = l.acoes;
    if (!acoesRaw || typeof acoesRaw !== 'object' || Array.isArray(acoesRaw)) {
      throw new BadRequestException(`Linha ${id}: acoes inválidas.`);
    }

    const acoes: Record<string, AcaoMatriz> = {};
    for (const [cicloId, acao] of Object.entries(acoesRaw as Record<string, unknown>)) {
      if (!ciclosIds.has(cicloId)) {
        throw new BadRequestException(
          `Linha ${id}: ação referencia ciclo inexistente (${cicloId}).`,
        );
      }
      const acaoStr = texto(acao);
      if (!ehAcaoMatriz(acaoStr)) {
        throw new BadRequestException(
          `Linha ${id}, ciclo ${cicloId}: ação "${acaoStr}" inválida.`,
        );
      }
      acoes[cicloId] = acaoStr;
    }

    return {
      id,
      categoria: texto(l.categoria),
      item: texto(l.item),
      especificacao: texto(l.especificacao),
      acoes,
    };
  });

  return { ciclos, linhas };
}
