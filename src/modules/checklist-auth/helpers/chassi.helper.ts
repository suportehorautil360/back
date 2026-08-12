export function normalizarChassi(input: string): string {
  return (input ?? '').toString().toUpperCase().replace(/\s+/g, '');
}
