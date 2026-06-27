export function timestampToIso(value: unknown): string {
  if (!value) return '';
  if (typeof value === 'string') return value;

  if (typeof value === 'object' && value !== null) {
    const rec = value as Record<string, unknown>;
    if (typeof rec.toDate === 'function') {
      const date = (rec.toDate as () => Date)();
      return Number.isNaN(date.getTime()) ? '' : date.toISOString();
    }
    if (typeof rec.seconds === 'number') {
      return new Date(rec.seconds * 1000).toISOString();
    }
  }

  return '';
}

export function timestampToSeconds(
  value: unknown,
): { seconds: number } | null {
  const iso = timestampToIso(value);
  if (!iso) return null;
  const ms = new Date(iso).getTime();
  if (Number.isNaN(ms)) return null;
  return { seconds: Math.floor(ms / 1000) };
}

export function formatDateBrFromIso(iso: string): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('pt-BR');
}

export function formatDateTimeBrFromIso(iso: string): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  const data = date.toLocaleDateString('pt-BR');
  const hora = date.toLocaleTimeString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
  });
  return `${data} ${hora}`;
}
