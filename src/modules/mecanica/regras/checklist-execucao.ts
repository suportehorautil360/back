/**
 * O que trava a conclusão de um checklist.
 *
 * As três regras existem por motivos diferentes, e nenhuma é burocracia:
 *
 * - **sem resposta** em item obrigatório: um checklist com buraco não prova
 *   nada sobre o buraco.
 * - **não conforme sem observação**: um "não conforme" mudo não serve para
 *   ninguém — nem para o gestor decidir, nem para o próximo mecânico.
 * - **exige foto e não tem**: é a diferença entre "o operador disse" e "está
 *   registrado". Nas famílias de transferência, é o que sustenta "a máquina
 *   saiu daqui sem essa avaria".
 *
 * O app tem a mesma regra em `features/checklist/regras.ts`, para a tela
 * mostrar o que falta enquanto ele preenche. Esta aqui é a que vale: o
 * servidor não confia no cliente para saber se um documento está completo.
 *
 * Funções puras — sem Prisma, sem I/O.
 */

export type ValorDaResposta = 'conforme' | 'nao_conforme' | 'na';
export type MotivoDePendencia = 'sem_resposta' | 'sem_observacao' | 'sem_foto';

export interface RespostaGravada {
  valor?: string;
  observacao?: string;
  fotos?: string[];
}

export interface ItemDoModelo {
  id: string;
  numero: number;
  descricao: string;
  obrigatorio?: boolean;
  foto?: 'nao' | 'se_nao_conforme' | 'sempre';
  impeditivo?: boolean;
}

export interface GrupoDoModelo {
  id: string;
  codigo: number;
  nome: string;
  itens: ItemDoModelo[];
}

export interface Pendencia {
  grupoId: string;
  grupoNome: string;
  itemId: string;
  numero: number;
  descricao: string;
  motivo: MotivoDePendencia;
}

/** `Modelo.grupos` é Json: o banco não garante o formato. */
export function lerGrupos(valor: unknown): GrupoDoModelo[] {
  if (!Array.isArray(valor)) return [];
  return valor.filter(
    (g): g is GrupoDoModelo =>
      typeof g === 'object' &&
      g !== null &&
      Array.isArray((g as GrupoDoModelo).itens),
  );
}

export function lerRespostas(valor: unknown): Record<string, RespostaGravada> {
  if (typeof valor !== 'object' || valor === null || Array.isArray(valor)) return {};
  return valor as Record<string, RespostaGravada>;
}

function texto(valor: unknown): string {
  return typeof valor === 'string' ? valor.trim() : '';
}

export function pendenciaDoItem(
  item: ItemDoModelo,
  resposta: RespostaGravada | undefined,
): MotivoDePendencia | null {
  const valor = texto(resposta?.valor);
  const obrigatorio = item.obrigatorio ?? true;

  if (!valor) return obrigatorio ? 'sem_resposta' : null;

  // Item não obrigatório que FOI respondido segue as demais regras: quem
  // respondeu "não conforme" precisa dizer o que viu, obrigatório ou não.
  if (valor === 'nao_conforme' && !texto(resposta?.observacao)) {
    return 'sem_observacao';
  }

  const exigeFoto =
    item.foto === 'sempre' || (item.foto === 'se_nao_conforme' && valor === 'nao_conforme');
  if (exigeFoto && !(resposta?.fotos ?? []).length) return 'sem_foto';

  return null;
}

export function pendencias(
  grupos: GrupoDoModelo[],
  respostas: Record<string, RespostaGravada>,
): Pendencia[] {
  const lista: Pendencia[] = [];
  for (const grupo of grupos) {
    for (const item of grupo.itens) {
      const motivo = pendenciaDoItem(item, respostas[item.id]);
      if (motivo) {
        lista.push({
          grupoId: grupo.id,
          grupoNome: grupo.nome,
          itemId: item.id,
          numero: item.numero,
          descricao: item.descricao,
          motivo,
        });
      }
    }
  }
  return lista;
}

/**
 * Os itens impeditivos reprovados.
 *
 * NÃO travam a conclusão: o registro fiel do que foi encontrado é o produto, e
 * um checklist de avarias de desembarque pode ter quinze não conformidades
 * legítimas de transporte. O que não pode é passar despercebido — por isso a
 * conclusão devolve a lista, e a tela mostra.
 */
export function impeditivosReprovados(
  grupos: GrupoDoModelo[],
  respostas: Record<string, RespostaGravada>,
): Pendencia[] {
  const lista: Pendencia[] = [];
  for (const grupo of grupos) {
    for (const item of grupo.itens) {
      if (!item.impeditivo) continue;
      if (texto(respostas[item.id]?.valor) !== 'nao_conforme') continue;
      lista.push({
        grupoId: grupo.id,
        grupoNome: grupo.nome,
        itemId: item.id,
        numero: item.numero,
        descricao: item.descricao,
        motivo: 'sem_resposta',
      });
    }
  }
  return lista;
}

/** Progresso de um grupo — o `[x/n]` que o mecânico vê na lista de seções. */
export function progressoDoGrupo(
  grupo: GrupoDoModelo,
  respostas: Record<string, RespostaGravada>,
): { resolvidos: number; total: number } {
  const total = grupo.itens.length;
  const resolvidos = grupo.itens.filter(
    (item) => pendenciaDoItem(item, respostas[item.id]) === null,
  ).length;
  return { resolvidos, total };
}

/**
 * Mescla as respostas de UM grupo, preservando os demais.
 *
 * É o que torna o "cancelar" de uma seção seguro e o que faz o trabalho de
 * terça sobreviver até quinta: gravar o checklist inteiro a cada seção
 * apagaria o que outra pessoa respondeu no intervalo.
 */
export function mesclarRespostasDoGrupo(
  atuais: Record<string, RespostaGravada>,
  grupo: GrupoDoModelo,
  novas: Record<string, RespostaGravada>,
): Record<string, RespostaGravada> {
  const idsDoGrupo = new Set(grupo.itens.map((i) => i.id));
  const resultado: Record<string, RespostaGravada> = { ...atuais };

  // Só o que pertence ao grupo entra: um corpo malicioso ou um bug de tela
  // não deve conseguir escrever resposta de outra seção.
  for (const [itemId, resposta] of Object.entries(novas)) {
    if (idsDoGrupo.has(itemId)) resultado[itemId] = resposta;
  }
  return resultado;
}
