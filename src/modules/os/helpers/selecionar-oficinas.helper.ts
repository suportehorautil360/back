import type { OficinaAtiva } from '../os.types';
import {
  oficinaAtendeLinha,
  oficinaAtendeSegmentoEquipamento,
} from './direcionamento-oficina.helper';

function shuffle<T>(items: T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

/**
 * Retorna oficinas compatíveis com segmento (quando informado) e linha do equipamento.
 * Considera todas as linhas de atuação cadastradas — não só a primeira especialidade.
 */
export function filtrarOficinasElegiveis(
  oficinas: OficinaAtiva[],
  linha: string,
  segmento?: string,
): OficinaAtiva[] {
  if (oficinas.length === 0) return [];

  let pool = oficinas;
  const segmentoNorm = segmento?.trim() ?? '';

  if (segmentoNorm) {
    pool = pool.filter((oficina) =>
      oficinaAtendeSegmentoEquipamento(
        oficina.segmentosAtuacao ?? [],
        oficina.linhasAtuacao ?? [],
        segmentoNorm,
      ),
    );
    if (pool.length === 0) return [];
  }

  const linhaNorm = linha.trim();
  if (!linhaNorm) return pool;

  return pool.filter((oficina) =>
    oficinaAtendeLinha(
      oficina.linhasAtuacao ?? [],
      oficina.especialidade,
      linhaNorm,
    ),
  );
}

/** Convida todas as oficinas elegíveis (sem limite). */
export function selecionarOficinas(
  oficinas: OficinaAtiva[],
  linha: string,
  max?: number,
  segmento?: string,
): OficinaAtiva[] {
  const pool = filtrarOficinasElegiveis(oficinas, linha, segmento);
  if (pool.length === 0) return [];
  const ordenadas = shuffle(pool);
  if (max == null || max <= 0) return ordenadas;
  return ordenadas.slice(0, max);
}
