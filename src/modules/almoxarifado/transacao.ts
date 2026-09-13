import { ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '../../prisma/generated/client';

/**
 * O que toda transação de estoque deste módulo precisa em comum: o laço de
 * retry por contenção, a ordem única de trava e a trava da requisição.
 *
 * Saiu de `almoxarifado.service.ts` na fundação da F4 porque as compras vão
 * travar as MESMAS linhas (`requisicoes_material`, `peca_saldos`) na MESMA
 * ordem. Duas cópias do comparador de trava é como uma delas muda um dia e a
 * outra não — e o deadlock volta.
 */

/**
 * Quantas vezes recalcular `numero`/reler o saldo antes de desistir.
 *
 * O brief original dizia "o unique de (company_id, numero) absorve a
 * concorrência" — mas um `@@unique` DETECTA colisão, não a absorve: sem
 * retry, a segunda de duas reservas abertas no mesmo segundo (o cenário que
 * esta tarefa existe para resolver) levava P2002 e derrubava a transação
 * inteira, sem requisição nenhuma. `nextProtocoloOsPg` (protocolo de OS)
 * tem o mesmo problema hoje e fica fora desta frente — aqui, resolvido.
 */
export const MAX_TENTATIVAS_CONCORRENCIA = 5;

/**
 * Nome do índice único parcial que garante NO MÁXIMO uma requisição aberta
 * por OS (migration `20260912195000_requisicao_unica_por_os`). Não existe
 * em `schema.prisma` — Prisma não expressa índice parcial (`WHERE`), mesma
 * situação de `operator_salario_vigente_key` em `OperatorSalario`.
 */
export const INDICE_REQUISICAO_UNICA_POR_OS = 'requisicoes_material_uma_aberta_por_os';

/**
 * O alvo de uma violação de unique, normalizado pra uma string só.
 *
 * `meta.target` varia de formato: às vezes um array de CAMPOS DO SCHEMA
 * (quando o Prisma reconhece a constraint por vir do `@@unique` declarado —
 * é o caso de `RequisicaoMaterial.@@unique([companyId, numero])`), às vezes
 * o NOME CRU do índice/constraint (quando o Prisma não tem de onde tirar os
 * campos — é o caso do índice único parcial acima, que só existe em SQL,
 * nunca em `schema.prisma`). Não achei confirmação de qual das duas formas
 * o Prisma 7 com `@prisma/adapter-pg` usa para um índice fora do schema
 * neste ambiente (sem Postgres acessível aos testes para reproduzir de
 * verdade) — por isso a função aceita as duas, em vez de supor uma.
 */
export function alvoDaViolacao(erro: Prisma.PrismaClientKnownRequestError): string {
  const target = (erro.meta as { target?: unknown } | undefined)?.target;
  if (Array.isArray(target)) return target.join(',');
  if (typeof target === 'string') return target;
  return '';
}

/**
 * Achado Important R1 (residual da revisão): a colisão no índice
 * `requisicoes_material_uma_aberta_por_os` NÃO é contenção — é a mesma regra
 * de negócio do achado I3 (uma OS não pode ter duas requisições abertas),
 * só que pega no banco em vez de na checagem de aplicação (que é TOCTOU sob
 * READ COMMITTED: duas transações em voo ao mesmo tempo leem "não existe" as
 * duas e as duas tentam inserir — só o INSERT que perde a corrida encontra o
 * índice). Tentar de novo não resolveria nada (a OS SEMPRE vai ter a
 * requisição da outra transação), e gastaria `MAX_TENTATIVAS_CONCORRENCIA`
 * tentativas travando `peca_saldos` à toa antes de desistir com uma
 * mensagem de "contenção" que estaria mentindo sobre o que aconteceu.
 */
export function colisaoDeRequisicaoJaAberta(erro: unknown): boolean {
  if (!(erro instanceof Prisma.PrismaClientKnownRequestError) || erro.code !== 'P2002') {
    return false;
  }
  const alvo = alvoDaViolacao(erro);
  return (
    alvo.includes(INDICE_REQUISICAO_UNICA_POR_OS) ||
    alvo.includes('serviceOrderId') ||
    alvo.includes('service_order_id')
  );
}

/**
 * Verdadeiro para os erros de CONTENÇÃO que vale a pena tentar de novo com a
 * transação inteira do zero:
 *
 * - `P2002` no índice de NÚMERO (`companyId, numero`) — duas transações
 *   calculando o mesmo MAX+1 ao mesmo tempo. Não confundir com o `P2002` do
 *   índice de requisição-única-por-OS (`colisaoDeRequisicaoJaAberta`, achado
 *   R1): aquele não é retentável, e por isso o chamador confere
 *   `colisaoDeRequisicaoJaAberta` ANTES desta função.
 * - `P2010` com `meta.code` `40P01` (deadlock) ou `40001` (falha de
 *   serialização) — os dois só existem em erro de `$queryRaw`/`$executeRaw`
 *   (as raw queries do `SELECT … FOR UPDATE`): é assim que o Prisma expõe o
 *   SQLSTATE cru do Postgres quando uma raw query falha. Achado Important
 *   I1: o laço de travas ordenado por `pecaId` (ver `executarReserva`) evita
 *   a maior parte dos deadlocks ENTRE duas chamadas deste método, mas não
 *   os elimina por completo (pooler de conexão, outra rota tocando a mesma
 *   linha), então o retry continua sendo a rede de segurança.
 * - `P2034`: "Transaction failed due to a write conflict or a deadlock" —
 *   achado Important R2, o equivalente do `40P01`/`40001` para operações
 *   NÃO-raw (`create`, `updateMany`, etc.) dentro de uma transação
 *   interativa. `40P01`/`40001` só chegam como `P2010`, e só em raw query;
 *   um deadlock no `requisicaoMaterial.create` ou no `serviceOrder.updateMany`
 *   chega como `P2034`, sem precisar olhar `meta` — o código já é inequívoco.
 */
export function erroDeContencaoTransitoria(erro: unknown): boolean {
  if (!(erro instanceof Prisma.PrismaClientKnownRequestError)) return false;
  if (erro.code === 'P2002') return !colisaoDeRequisicaoJaAberta(erro) && alvoDaViolacao(erro).includes('numero');
  if (erro.code === 'P2010') {
    const sqlstate = (erro.meta as { code?: string } | undefined)?.code;
    return sqlstate === '40P01' || sqlstate === '40001';
  }
  if (erro.code === 'P2034') return true;
  return false;
}

/**
 * A ordem única de trava de `peca_saldos` entre chamadas concorrentes: por
 * `pecaId` ascendente, `null` como string vazia. É o MESMO comparador em todo
 * método que trava saldo — por isso mora aqui, uma vez só. Não troque por
 * `localeCompare`: ele diverge deste em UUID de case misto e depende do ICU
 * do runtime.
 */
export function compararPorPeca(
  a: string | null | undefined,
  b: string | null | undefined,
): number {
  const pa = a ?? '';
  const pb = b ?? '';
  return pa < pb ? -1 : pa > pb ? 1 : 0;
}

/**
 * Trava a linha da requisição. É o PRIMEIRO passo de toda transação que muda
 * item de uma requisição ou recalcula o `statusMateriais` da OS dela:
 * separação, liberação, entrega e cancelamento — e, na F4, recebimento de
 * compra, pedido de peça adicional e emissão de ordem de compra.
 *
 * É o que torna verdadeira, por construção, a premissa que as correções
 * desta frente tentaram garantir item a item: com a requisição travada,
 * nenhum OUTRO escritor muda a lista de itens, as quantidades ou o status
 * dela até o commit, porque todos eles passam por aqui antes de escrever. O
 * que se relê DEPOIS desta chamada é o estado que vale para decidir. Até a F3
 * dava para argumentar que a reserva de um item "só desce" depois de criada;
 * o recebimento de compra passa a SUBIR a reserva de um item faltante, e esse
 * argumento deixou de valer.
 *
 * Ordem única de trava — a mesma em todo método, senão é deadlock:
 * cabeçalho da ordem de compra → requisições (por id) → linhas de solicitação
 * de compra → `peca_saldos` (por `pecaId`, `compararPorPeca`) → ordem de
 * serviço.
 *
 * Trava e só. Quem chama relê os campos de que precisa com o client da
 * transação, DEPOIS desta chamada — nunca decide pelo retrato lido fora dela.
 */
export async function travarRequisicao(
  tx: Prisma.TransactionClient,
  requisicaoId: string,
  companyId: string,
): Promise<void> {
  const linhas = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
    SELECT id FROM requisicoes_material
     WHERE id = ${requisicaoId}::uuid
       AND company_id = ${companyId}::uuid
       FOR UPDATE
  `);
  if (!linhas[0]) {
    throw new NotFoundException('Requisição não encontrada para esta empresa.');
  }
}

/**
 * Roda `operacao` — normalmente um `$transaction` inteiro — de novo quando o
 * banco devolve contenção transitória (`erroDeContencaoTransitoria`). A
 * transação inteira é a unidade de retry: depois de um erro o Postgres marca
 * a transação como abortada, e refazê-la do zero relê tudo sob travas novas.
 *
 * Qualquer outro erro (inclusive `ConflictException`/`BadRequestException`
 * lançadas dentro da transação) sobe na primeira vez — é recusa de negócio,
 * e tentar de novo não mudaria a resposta.
 *
 * Nada que tenha efeito fora do banco (notificação) pode morar dentro de
 * `operacao`: uma tentativa que falha e é refeita o repetiria.
 */
export async function comRetryDeContencao<T>(
  descricao: string,
  operacao: () => Promise<T>,
): Promise<T> {
  for (let tentativa = 1; tentativa <= MAX_TENTATIVAS_CONCORRENCIA; tentativa++) {
    try {
      return await operacao();
    } catch (erro) {
      if (!erroDeContencaoTransitoria(erro)) throw erro;
      if (tentativa === MAX_TENTATIVAS_CONCORRENCIA) {
        throw new ConflictException(
          `Não foi possível concluir ${descricao} após ` +
            `${MAX_TENTATIVAS_CONCORRENCIA} tentativas por contenção — tente novamente.`,
        );
      }
    }
  }
  // Inalcançável: o laço acima sempre retorna ou lança. Só aqui pro TS
  // aceitar que a função tem um valor de retorno em todo caminho.
  throw new ConflictException(`Não foi possível concluir ${descricao}.`);
}
