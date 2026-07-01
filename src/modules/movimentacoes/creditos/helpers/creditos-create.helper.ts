import type { CreditType } from '../creditos.types';

export function parseCreditAmount(value: number): number | null {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) {
    return null;
  }
  return Math.round(amount * 100) / 100;
}

export function creditTypeLabel(type: CreditType): string {
  return type === 'equipment' ? 'Equipamento' : 'Frente';
}

export function formatCreditDateLabel(isoString: string): string {
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) {
    return isoString;
  }

  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = date.getFullYear();
  return `${day}/${month}/${year}`;
}

export function formatCreditAmountLabel(amount: number): string {
  const formatted = amount.toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  });
  return `+ ${formatted}`;
}

export function resolveEquipmentPlateOrChassis(
  raw: Record<string, unknown>,
): string {
  return asString(
    raw.chassis ?? raw.chassi ?? raw.placa ?? raw.plate ?? raw.patrimonioBase,
  );
}

export function buildEquipamentoLabel(raw: Record<string, unknown>): string {
  const nome = asString(raw.descricao ?? raw.label ?? raw.nome);
  const placa = resolveEquipmentPlateOrChassis(raw);
  if (nome && placa) return `${placa} — ${nome}`;
  return nome || placa || 'Equipamento';
}

export function buildEquipamentoKeywords(
  raw: Record<string, unknown>,
): string[] {
  const placa = asString(raw.placa ?? raw.plate);
  const candidates = [
    placa,
    placa.replace(/[^A-Za-z0-9]/g, ''),
    asString(raw.chassis ?? raw.chassi),
    asString(raw.patrimonioBase),
    asString(raw.renavam),
    asString(raw.numeroSerie),
    asString(raw.prefixo),
  ];

  return [...new Set(candidates.filter(Boolean))];
}

export function buildFrenteLabel(raw: Record<string, unknown>): string {
  return asString(raw.name ?? raw.nome) || 'Frente de trabalho';
}

function asString(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return '';
}
