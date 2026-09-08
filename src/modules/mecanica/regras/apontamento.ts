/**
 * Regras de intervalo do apontamento. Módulo puro: sem Prisma, sem Nest, sem
 * relógio próprio — é o que permite testar sobreposição em milissegundos, e
 * é a mesma disciplina do núcleo do operador-app.
 */

export type Intervalo = {
  /** Presente ao editar; ausente ao criar. */
  id?: string;
  inicio: Date;
  /** `null` = apontamento ABERTO, que se estende até agora. */
  fim: Date | null;
};

/** Sem fim, o intervalo vale até este instante. */
const INFINITO = 8_640_000_000_000_000;

function fimEm(i: Intervalo): number {
  return i.fim ? i.fim.getTime() : INFINITO;
}

/** Duração zero também é inválida: apontamento tem que ter tamanho. */
export function intervaloInvalido(inicio: Date, fim: Date | null): boolean {
  if (fim === null) return false;
  return fim.getTime() <= inicio.getTime();
}

/**
 * Dois intervalos se sobrepõem quando cada um começa antes de o outro acabar.
 * Encostar (fim de um == início do outro) NÃO é sobreposição — o mecânico que
 * fecha às 10:00 e recomeça às 10:00 fez duas tarefas, não uma dupla contagem.
 */
export function haSobreposicao(
  novo: Intervalo,
  existentes: readonly Intervalo[],
): boolean {
  const inicioNovo = novo.inicio.getTime();
  const fimNovo = fimEm(novo);

  return existentes.some((e) => {
    if (novo.id !== undefined && e.id === novo.id) return false;
    return inicioNovo < fimEm(e) && e.inicio.getTime() < fimNovo;
  });
}
