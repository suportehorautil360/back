/**
 * Critério 12: a ordem de compra que passou do prazo.
 *
 * Módulo puro — sem Prisma, sem Nest. Quem varre e avisa é
 * `atraso-agendador.ts`; aqui mora só a decisão do que conta como atraso.
 */

/**
 * As ordens que estão COM O FORNECEDOR — as únicas em que prazo faz sentido.
 * Espelha `EMITIDA_ABERTA` de `regras/compras.ts`: rascunho e aguardando
 * aprovação nem foram enviadas; recebida, encerrada e cancelada não têm mais
 * nada a caminho.
 */
const A_CAMINHO = new Set(['emitida', 'enviada', 'recebida_parcial']);

const UM_DIA = 24 * 60 * 60 * 1000;

export interface OrdemComPrazo {
  id: string;
  numero: string;
  status: string;
  previsaoEntrega: Date | null;
}

export interface OrdemAtrasada extends OrdemComPrazo {
  previsaoEntrega: Date;
  diasDeAtraso: number;
}

/** Só o dia (UTC): comparar com hora faria a ordem "vencer" no meio do dia. */
function apenasODia(d: Date): number {
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

/**
 * `previsaoEntrega` nula NÃO é atraso. Cobrar prazo que ninguém combinou vira
 * alerta que o comprador aprende a ignorar — e aí ele ignora os de verdade
 * junto.
 *
 * A previsão de HOJE também não é atraso: o dia ainda não acabou.
 */
export function estaAtrasada(ordem: OrdemComPrazo, hoje: Date): boolean {
  if (!ordem.previsaoEntrega) return false;
  if (!A_CAMINHO.has(ordem.status)) return false;
  return apenasODia(ordem.previsaoEntrega) < apenasODia(hoje);
}

/** Dias inteiros de atraso. Previsão no futuro devolve zero, nunca negativo. */
export function diasDeAtraso(previsaoEntrega: Date, hoje: Date): number {
  const dias = Math.floor((apenasODia(hoje) - apenasODia(previsaoEntrega)) / UM_DIA);
  return Math.max(0, dias);
}

/** As atrasadas, da mais atrasada para a menos — é por onde o comprador começa. */
export function ordensAtrasadas<T extends OrdemComPrazo>(
  ordens: T[],
  hoje: Date,
): Array<T & { diasDeAtraso: number }> {
  return ordens
    .filter((o) => estaAtrasada(o, hoje))
    .map((o) => ({ ...o, diasDeAtraso: diasDeAtraso(o.previsaoEntrega as Date, hoje) }))
    .sort((a, b) => b.diasDeAtraso - a.diasDeAtraso);
}
