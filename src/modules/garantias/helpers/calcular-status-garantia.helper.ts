import type { GarantiaStatus } from '../garantias.types';

const MS_POR_DIA = 86_400_000;

export const GARANTIA_PRAZO_MESES_PADRAO = 3;
export const GARANTIA_HORIMETRO_DELTA_PADRAO = 500;
export const GARANTIA_DIAS_ALERTA = 30;
export const GARANTIA_HORAS_ALERTA = 50;

export function adicionarMeses(dataIso: string, meses: number): string {
  const base = new Date(`${dataIso.slice(0, 10)}T12:00:00.000Z`);
  if (Number.isNaN(base.getTime())) {
    const hoje = new Date();
    hoje.setUTCMonth(hoje.getUTCMonth() + meses);
    return hoje.toISOString().slice(0, 10);
  }
  base.setUTCMonth(base.getUTCMonth() + meses);
  return base.toISOString().slice(0, 10);
}

export function formatDataBr(isoDate: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(isoDate);
  if (!m) return isoDate;
  return `${m[3]}/${m[2]}/${m[1]}`;
}

export function calcularStatusGarantia(params: {
  venceEmIso: string;
  limiteHorimetro: number;
  horimetroAtual?: number | null;
  agora?: Date;
  diasAlerta?: number;
  horasAlerta?: number;
}): GarantiaStatus {
  const agora = params.agora ?? new Date();
  const diasAlerta = params.diasAlerta ?? GARANTIA_DIAS_ALERTA;
  const horasAlerta = params.horasAlerta ?? GARANTIA_HORAS_ALERTA;

  const fim = new Date(`${params.venceEmIso.slice(0, 10)}T23:59:59.999Z`);
  const horimetro = params.horimetroAtual;

  if (!Number.isNaN(fim.getTime()) && agora.getTime() > fim.getTime()) {
    return 'vencido';
  }
  if (
    horimetro != null &&
    Number.isFinite(horimetro) &&
    horimetro > params.limiteHorimetro
  ) {
    return 'vencido';
  }

  if (!Number.isNaN(fim.getTime())) {
    const diasRestantes = (fim.getTime() - agora.getTime()) / MS_POR_DIA;
    if (diasRestantes >= 0 && diasRestantes <= diasAlerta) {
      return 'vencendo';
    }
  }

  if (
    horimetro != null &&
    Number.isFinite(horimetro) &&
    params.limiteHorimetro - horimetro <= horasAlerta &&
    params.limiteHorimetro - horimetro >= 0
  ) {
    return 'vencendo';
  }

  return 'vigente';
}
