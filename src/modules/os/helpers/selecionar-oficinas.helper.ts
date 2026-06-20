import type { OficinaAtiva } from '../os.types';
import { especialidadeCompativel } from './norm-esp.helper';

function shuffle<T>(items: T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

/**
 * Seleciona até `max` oficinas para convite.
 * 1) Filtra por especialidade compatível com a linha.
 * 2) Se nenhuma match, usa todas as oficinas ativas (fallback do front antigo).
 */
export function selecionarOficinas(
  oficinas: OficinaAtiva[],
  linha: string,
  max = 3,
): OficinaAtiva[] {
  if (oficinas.length === 0) return [];

  const linhaNorm = linha.trim();
  const matches = linhaNorm
    ? oficinas.filter((o) =>
        especialidadeCompativel(o.especialidade, linhaNorm),
      )
    : [];

  const pool = matches.length > 0 ? matches : oficinas;
  return shuffle(pool).slice(0, max);
}
