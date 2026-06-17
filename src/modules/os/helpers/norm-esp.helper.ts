/** Normaliza texto para comparar linha do equipamento × especialidade da oficina. */
export function normEsp(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

/**
 * Compatível com o AbrirOsSection antigo: igualdade ou includes bidirecional.
 */
export function especialidadeCompativel(
  especialidade: string,
  linha: string,
): boolean {
  const e = normEsp(especialidade);
  const l = normEsp(linha);
  if (!e || !l) return false;
  return e === l || e.includes(l) || l.includes(e);
}
