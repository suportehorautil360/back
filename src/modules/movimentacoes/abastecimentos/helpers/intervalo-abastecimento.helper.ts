import { createdAtToIso } from '../../shared/prefeitura-query.helper';

/** Intervalo mínimo entre abastecimentos do mesmo veículo (3 horas). */
export const INTERVALO_MINIMO_ABASTECIMENTO_MS = 3 * 60 * 60 * 1000;
export const INTERVALO_MINIMO_ABASTECIMENTO_HORAS = 3;

export interface StatusIntervaloAbastecimento {
  liberado: boolean;
  proximoEmMs: number | null;
  ultimoEmMs: number | null;
}

export function parseAbastecimentoTimestampMs(doc: {
  createdAt?: unknown;
  criadoEm?: unknown;
}): number | null {
  const iso = createdAtToIso(doc.createdAt) || createdAtToIso(doc.criadoEm);
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
}

export function ultimoAbastecimentoTimestampMs(
  docs: Array<{
    prefeituraId?: string;
    equipmentId?: string;
    createdAt?: unknown;
    criadoEm?: unknown;
  }>,
  prefeituraId: string,
  equipmentId: string,
): number | null {
  let max: number | null = null;
  for (const doc of docs) {
    if (doc.prefeituraId !== prefeituraId || doc.equipmentId !== equipmentId) {
      continue;
    }
    const t = parseAbastecimentoTimestampMs(doc);
    if (t === null) continue;
    if (max === null || t > max) max = t;
  }
  return max;
}

export function verificarIntervaloAbastecimento(
  ultimoEmMs: number | null,
  agoraMs = Date.now(),
  intervaloMs = INTERVALO_MINIMO_ABASTECIMENTO_MS,
): StatusIntervaloAbastecimento {
  if (ultimoEmMs === null) {
    return { liberado: true, proximoEmMs: null, ultimoEmMs: null };
  }
  const proximoEmMs = ultimoEmMs + intervaloMs;
  return {
    liberado: agoraMs >= proximoEmMs,
    proximoEmMs,
    ultimoEmMs,
  };
}

export function mensagemIntervaloAbastecimento(proximoEmMs: number): string {
  const hora = new Date(proximoEmMs).toLocaleTimeString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
  });
  return (
    `Aguarde ${INTERVALO_MINIMO_ABASTECIMENTO_HORAS} horas entre abastecimentos. ` +
    `Próximo permitido às ${hora}.`
  );
}
