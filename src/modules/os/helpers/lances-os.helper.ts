import type { LanceOs } from '../os.types';

function texto(valor: unknown): string {
  return typeof valor === 'string' ? valor.trim() : '';
}

function numero(valor: unknown): number {
  if (typeof valor === 'number') return Number.isFinite(valor) ? valor : 0;
  if (typeof valor === 'string') {
    const n = Number(valor.replace(',', '.'));
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

export function parseLances(raw: unknown): LanceOs[] {
  if (!Array.isArray(raw)) return [];

  const lances: LanceOs[] = [];

  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const rec = item as Record<string, unknown>;
    const oficinaId = texto(rec.oficinaId);
    if (!oficinaId) continue;

    lances.push({
      oficinaId,
      valor: numero(rec.valor),
      prazoDias: Math.max(1, Math.round(numero(rec.prazoDias) || 7)),
      ...(texto(rec.ordemServicoId)
        ? { ordemServicoId: texto(rec.ordemServicoId) }
        : {}),
      ...(texto(rec.atualizadoEm)
        ? { atualizadoEm: texto(rec.atualizadoEm) }
        : {}),
    });
  }

  return lances;
}

export function valorOrcadoForOficina(
  lances: LanceOs[],
  oficinaId: string,
): number | null {
  const lance = lances.find((item) => item.oficinaId === oficinaId);
  return lance && lance.valor > 0 ? lance.valor : null;
}

export function mergeLance(
  lances: LanceOs[],
  novo: LanceOs,
): LanceOs[] {
  const rest = lances.filter((item) => item.oficinaId !== novo.oficinaId);
  return [...rest, novo];
}

/** Após envio de orçamento: em_orcamento enquanto faltam respostas; pregao quando todas responderam. */
export function statusAposOrcamento(
  oficinasIds: string[],
  oficinasResponderam: string[],
): 'em_orcamento' | 'pregao' {
  const convidadas = oficinasIds.filter(Boolean);
  if (convidadas.length === 0) return 'em_orcamento';

  const todasResponderam = convidadas.every((id) =>
    oficinasResponderam.includes(id),
  );
  return todasResponderam ? 'pregao' : 'em_orcamento';
}

export function parseOficinasResponderam(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((v): v is string => typeof v === 'string' && v.trim() !== '');
}

export function parseOficinasIds(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((v): v is string => typeof v === 'string' && v.trim() !== '');
}

export function resolveOficinaVencedoraId(
  raw: Record<string, unknown>,
  lances: LanceOs[],
): string {
  const direct = texto(raw.oficinaVencedoraId);
  if (direct) return direct;

  const ordemAprovadaId = texto(raw.ordemServicoAprovadaId);
  if (!ordemAprovadaId) return '';

  const lance = lances.find(
    (item) => texto(item.ordemServicoId) === ordemAprovadaId,
  );
  return lance?.oficinaId ?? '';
}

export function resolveValorAprovado(
  raw: Record<string, unknown>,
  lances: LanceOs[],
  oficinaVencedoraId: string,
): number | null {
  const rawValor = raw.valorAprovado;
  if (typeof rawValor === 'number' && Number.isFinite(rawValor) && rawValor > 0) {
    return rawValor;
  }

  if (!oficinaVencedoraId) return null;

  const lance = lances.find((item) => item.oficinaId === oficinaVencedoraId);
  return lance && lance.valor > 0 ? lance.valor : null;
}
