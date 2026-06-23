/** Converte "6890,2" / "6.890,2 h" / "42330" em número. */
export function parseHorimetro(valor: unknown): number | null {
  if (typeof valor === 'number' && Number.isFinite(valor)) return valor;
  if (typeof valor !== 'string') return null;

  const limpo = valor
    .trim()
    .replace(/\s*h\s*$/i, '')
    .replace(/\s*km\s*$/i, '')
    .replace(/\./g, '')
    .replace(',', '.')
    .replace(/[^\d.]/g, '');

  if (!limpo) return null;
  const n = Number(limpo);
  return Number.isFinite(n) ? n : null;
}

export function formatHorimetro(valor: number): string {
  return valor.toLocaleString('pt-BR', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 1,
  });
}
