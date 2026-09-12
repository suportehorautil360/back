/**
 * O estado dos MATERIAIS da OS — coluna própria, não `situacao`.
 *
 * Doze valores nesta fase. A corretiva acrescenta `em_diagnostico` e
 * `aguardando_validacao` na frente da máquina.
 */
export const STATUS_MATERIAIS = [
  'planejada',
  'em_analise_materiais',
  'aguardando_compra',
  'compra_em_andamento',
  'recebimento_parcial',
  'aguardando_separacao',
  'materiais_separados',
  'liberada_para_execucao',
  'em_execucao',
  'aguardando_peca_adicional',
  'concluida',
  'cancelada',
] as const;

export type StatusMateriais = (typeof STATUS_MATERIAIS)[number];

/** O que basta saber de um item para decidir o estado da OS. */
export interface ItemParaStatus {
  impeditivo: boolean;
  status: string;
}

const ATENDIDO = new Set(['separada', 'entregue']);
const FORA = new Set(['cancelada']);

/**
 * Item sem peça de troca nenhuma libera na hora: ciclo só de inspeção não
 * depende do almoxarifado, e pôr um kit vazio na fila do almoxarife é ruído.
 *
 * Achado Critical C3 da revisão da Task 9: chamador que FILTRA os itens
 * `nao_vinculado` antes de chamar esta função (por não terem `pecaId`) faz um
 * plano cuja única linha de troca não resolveu peça alguma cair em
 * `vivos.length === 0` — e sair `liberada_para_execucao`, como se estivesse
 * tudo certo. Por isso esta função espera receber TODOS os itens, inclusive
 * os não vinculados, e trata `nao_vinculado` ANTES de `faltante`: não dá
 * para decidir comprar o que ninguém sabe o que é, então o item nem chega a
 * "falta" — precisa de alguém resolver o vínculo primeiro.
 */
export function statusAposConsulta(itens: ItemParaStatus[]): StatusMateriais {
  const vivos = itens.filter((i) => !FORA.has(i.status));
  if (vivos.length === 0) return 'liberada_para_execucao';
  if (vivos.some((i) => i.status === 'nao_vinculado')) return 'em_analise_materiais';
  if (vivos.some((i) => i.status === 'faltante')) return 'aguardando_compra';
  return 'aguardando_separacao';
}

/**
 * O critério de liberação: TODOS os impeditivos separados.
 *
 * Restando apenas não-impeditivos, quem decide é o programador, com
 * justificativa — e isso mora na camada de cima, não aqui.
 *
 * `nao_vinculado` NÃO está em `ATENDIDO` (achado C3 da revisão): um item
 * impeditivo sem peça resolvida nunca conta como liberado por aqui — e isso
 * já valia mesmo antes deste comentário, só não tinha teste que o provasse.
 */
export function podeLiberar(itens: ItemParaStatus[]): boolean {
  return itens
    .filter((i) => i.impeditivo && !FORA.has(i.status))
    .every((i) => ATENDIDO.has(i.status));
}
