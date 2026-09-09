/**
 * Qual manual serve qual máquina.
 *
 * Um manual pode estar preso a uma máquina específica, valer para todas de um
 * modelo, valer para todas de um tipo, ou valer para a frota inteira. Isso
 * existe porque a alternativa — subir o mesmo PDF uma vez por máquina — faz o
 * arquivo do modelo virar doze linhas para atualizar quando o fabricante
 * revisa.
 *
 * Funções puras: sem Prisma, para o teste provar a regra sem banco.
 */

export interface ManualParaCasar {
  equipmentId: string | null;
  modelo: string | null;
  tipo: string | null;
}

export interface MaquinaParaCasar {
  id: string;
  modelo: string | null;
  tipo: string | null;
}

function igual(a: string | null, b: string | null): boolean {
  if (!a || !b) return false;
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/**
 * Quão específico é este manual para esta máquina.
 *
 * Maior = mais específico. Serve para ordenar: o manual daquela máquina vem
 * antes do manual do modelo, que vem antes do procedimento geral da frota —
 * que é a ordem em que o mecânico quer encontrar.
 *
 * `null` quando o manual não serve a esta máquina.
 */
export function especificidade(
  manual: ManualParaCasar,
  maquina: MaquinaParaCasar,
): number | null {
  if (manual.equipmentId) {
    return manual.equipmentId === maquina.id ? 3 : null;
  }
  if (manual.modelo) {
    return igual(manual.modelo, maquina.modelo) ? 2 : null;
  }
  if (manual.tipo) {
    return igual(manual.tipo, maquina.tipo) ? 1 : null;
  }
  // Sem nenhum vínculo: procedimento geral, vale para a frota inteira.
  return 0;
}

export function serveAMaquina(
  manual: ManualParaCasar,
  maquina: MaquinaParaCasar,
): boolean {
  return especificidade(manual, maquina) !== null;
}

/**
 * Os manuais desta máquina, do mais específico para o mais geral. Empate
 * desempata pelo título, para a lista não dançar entre uma abertura e outra.
 */
export function ordenarParaMaquina<T extends ManualParaCasar & { titulo: string }>(
  manuais: T[],
  maquina: MaquinaParaCasar,
): T[] {
  return manuais
    .map((m) => ({ m, peso: especificidade(m, maquina) }))
    .filter((x): x is { m: T; peso: number } => x.peso !== null)
    .sort((a, b) => b.peso - a.peso || a.m.titulo.localeCompare(b.m.titulo, 'pt-BR'))
    .map((x) => x.m);
}
