function texto(valor: unknown): string {
  return typeof valor === 'string' ? valor.trim() : '';
}

export type OldPartDestination =
  | 'Descarte ecológico'
  | 'Devolvida ao cliente'
  | '';

export function mapOldPartDestinationValue(raw: unknown): OldPartDestination {
  const value = texto(raw).toLowerCase();
  if (!value) return '';

  if (
    value.includes('descarte') ||
    value.includes('ecológico') ||
    value.includes('ecologico')
  ) {
    return 'Descarte ecológico';
  }
  if (value.includes('devolv') || value.includes('cliente')) {
    return 'Devolvida ao cliente';
  }

  const exact = texto(raw);
  if (exact === 'Descarte ecológico' || exact === 'Devolvida ao cliente') {
    return exact;
  }
  return '';
}
