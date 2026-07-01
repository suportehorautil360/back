import type { OficinaAtiva } from '../os.types';
import { especialidadeCompativel } from './norm-esp.helper';
import { oficinaAtendeSegmento } from './segmento-equipamento.helper';

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
 * 1) Filtra por segmento do equipamento (quando informado).
 * 2) Filtra por especialidade compatível com a linha.
 * 3) Se nenhuma match, usa pool anterior (fallback do front antigo).
 */
export function selecionarOficinas(
  oficinas: OficinaAtiva[],
  linha: string,
  max = 3,
  segmento?: string,
): OficinaAtiva[] {
  if (oficinas.length === 0) return [];

  let pool = oficinas;
  const segmentoNorm = segmento?.trim() ?? '';

  if (segmentoNorm) {
    const porSegmento = pool.filter((oficina) =>
      oficinaAtendeSegmento(oficina.segmentosAtuacao ?? [], segmentoNorm),
    );
    if (porSegmento.length > 0) {
      pool = porSegmento;
    }
  }

  const linhaNorm = linha.trim();
  const matches = linhaNorm
    ? pool.filter((o) => especialidadeCompativel(o.especialidade, linhaNorm))
    : [];

  const finalPool = matches.length > 0 ? matches : pool;
  return shuffle(finalPool).slice(0, max);
}
