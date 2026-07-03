import type {
  ChecklistRegistroDoc,
  TopOperadorChecklist,
} from '../checklists-registros.types';

export function filtrarChecklistsPorMes(
  registros: ChecklistRegistroDoc[],
  mes: string,
): ChecklistRegistroDoc[] {
  const prefixo = mes.trim();
  if (!prefixo) return registros;

  return registros.filter((item) => item.dataHoraIso.startsWith(prefixo));
}

export function calcularTopOperadores(
  registros: ChecklistRegistroDoc[],
  limite = 5,
): TopOperadorChecklist[] {
  const contagem = new Map<string, number>();

  for (const registro of registros) {
    const operador = registro.operador.trim();
    if (!operador) continue;
    contagem.set(operador, (contagem.get(operador) ?? 0) + 1);
  }

  return [...contagem.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limite)
    .map(([nome, total]) => ({ nome, total }));
}

export function calcularChecklistsPorSemana(
  registros: ChecklistRegistroDoc[],
): number[] {
  const semanas = [0, 0, 0, 0];

  for (const registro of registros) {
    const dataStr = registro.dataHoraIso;
    if (!dataStr || dataStr.length < 10) continue;

    const dia = Number.parseInt(dataStr.slice(8, 10), 10);
    if (!Number.isFinite(dia)) continue;

    const indice =
      dia <= 7 ? 0 : dia <= 14 ? 1 : dia <= 21 ? 2 : 3;
    semanas[indice] += 1;
  }

  return semanas;
}
