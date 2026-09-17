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
 * A ORDEM ÚNICA DE TRAVA do módulo, do primeiro ao último lock de uma
 * transação — quem precisa de menos pula etapas, nunca inverte:
 *
 *   ordem de compra (cabeçalho)
 *   → requisições (por id)
 *   → cabeçalho de inventário ou de transferência (por id)
 *   → linhas de item de solicitação de compra (por id)
 *   → `peca_saldos` (por `pecaId`, `compararPorPeca`; quando a transação toca
 *     duas linhas da MESMA peça em depósitos diferentes — só a transferência —
 *     por `compararPorPecaEDeposito`)
 *   → cabeçalhos de solicitação de compra (por id)
 *   → OS
 *
 * Recebimento e os atos da ordem de compra seguem a lista inteira. Exceção
 * conhecida: o cancelamento de requisição (`cancelarSolicitacoesDasFaltas`)
 * grava o cabeçalho da solicitação ANTES do saldo. Não abre deadlock porque a
 * solicitação que ele toca é sempre de falta da própria requisição — uma por
 * requisição — e todo outro escritor desse cabeçalho (recebimento, atos da OC)
 * trava essa requisição antes. Uma solicitação que junte faltas de requisições
 * diferentes quebra esse argumento: aí o cancelamento precisa passar a gravar
 * o cabeçalho depois do saldo.
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
 * Nome do índice único parcial que garante NO MÁXIMO uma contagem de
 * inventário aberta por depósito (migration `20260917100000_inventario_
 * ciclico`). Mesma situação de `INDICE_REQUISICAO_UNICA_POR_OS`: não existe
 * em `schema.prisma` — Prisma não expressa índice parcial (`WHERE`).
 */
export const INDICE_CONTAGEM_UNICA_POR_DEPOSITO = 'inventarios_uma_aberta_por_deposito';

/**
 * A causa que o `@prisma/adapter-pg` pendura no erro do Prisma 7, em
 * `meta.driverAdapterError.cause`. Conferido no código instalado do adapter
 * (`mapDriverError`) e do client (`We`/`fp`/`gp`):
 * - `23505` (unique) vira `kind: 'UniqueConstraintViolation'` com
 *   `constraint.fields` = as COLUNAS tiradas do `detail` do Postgres
 *   ("Key (company_id, numero)=…") — nunca o nome do índice;
 * - todo erro traz `originalCode`, o SQLSTATE cru.
 */
interface CausaDoAdapter {
  originalCode?: string;
  kind?: string;
  constraint?: { fields?: string[]; index?: string };
}

function causaDoAdapter(erro: Prisma.PrismaClientKnownRequestError): CausaDoAdapter | undefined {
  return (erro.meta as { driverAdapterError?: { cause?: CausaDoAdapter } } | undefined)?.driverAdapterError?.cause;
}

/**
 * O alvo de uma violação de unique, normalizado pra uma string só.
 *
 * Em produção (Prisma 7 + `@prisma/adapter-pg`) o `P2002` chega SEM
 * `meta.target`: o alvo são as colunas de `cause.constraint.fields`
 * (`company_id,numero`; `service_order_id` no índice parcial de requisição
 * aberta por OS). Até esta correção a função só lia `meta.target`, devolvia
 * `''` em produção, e nenhuma colisão de número era refeita. `meta.target`
 * (campos do schema ou nome do índice) continua aceito: é o formato do client
 * sem adapter e o que as specs antigas fabricam.
 */
export function alvoDaViolacao(erro: Prisma.PrismaClientKnownRequestError): string {
  const target = (erro.meta as { target?: unknown } | undefined)?.target;
  if (Array.isArray(target)) return target.join(',');
  if (typeof target === 'string') return target;
  const restricao = causaDoAdapter(erro)?.constraint;
  if (restricao?.fields?.length) return restricao.fields.join(',');
  if (restricao?.index) return restricao.index;
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
 * Achado Important I1 (revisão final do inventário cíclico): o MESMO caso de
 * `colisaoDeRequisicaoJaAberta`, agora para `inventarios_uma_aberta_por_
 * deposito` — a checagem de `abrirInventario` (`findFirst` por
 * `depositoId`+`status: 'aberta'`) é TOCTOU sob READ COMMITTED: dois cliques
 * simultâneos no mesmo depósito leem "não há contagem aberta" os dois, e só o
 * INSERT que perde a corrida esbarra no índice. Não é contenção — repetir a
 * transação não resolve nada (o depósito SEMPRE vai ter a contagem da outra
 * transação) — e por isso o chamador precisa traduzir isto em
 * `ConflictException` em vez de deixar o `P2002` cru virar 500.
 */
export function colisaoDeContagemJaAberta(erro: unknown): boolean {
  if (!(erro instanceof Prisma.PrismaClientKnownRequestError) || erro.code !== 'P2002') {
    return false;
  }
  const alvo = alvoDaViolacao(erro);
  return (
    alvo.includes(INDICE_CONTAGEM_UNICA_POR_DEPOSITO) ||
    alvo.includes('depositoId') ||
    alvo.includes('deposito_id')
  );
}

/**
 * Verdadeiro para os erros de CONTENÇÃO que vale a pena tentar de novo com a
 * transação inteira do zero:
 *
 * - `P2002` no índice de NÚMERO (`companyId, numero`) — duas transações
 *   calculando o mesmo MAX+1 ao mesmo tempo. Não confundir com o `P2002` do
 *   índice de requisição-única-por-OS (`colisaoDeRequisicaoJaAberta`, achado
 *   R1) nem com o de contagem-única-por-depósito
 *   (`colisaoDeContagemJaAberta`, achado I1 do inventário cíclico): nenhum
 *   dos dois é retentável, e por isso o chamador confere os dois ANTES desta
 *   função.
 * - SQLSTATE `40P01` (deadlock) ou `40001` (falha de serialização). Com o
 *   adapter, uma raw query (`$queryRaw`/`$executeRaw`, as travas `FOR
 *   UPDATE`) que falha chega SEMPRE como `P2010`, e o SQLSTATE está em
 *   `cause.originalCode` — não em `meta.code`, que só o client sem adapter
 *   preenche. Numa operação de modelo, `40001` chega como `P2034` e `40P01`
 *   como `P2039` (erro Postgres sem tradução própria), também com o SQLSTATE
 *   na causa. Achado Important I1: o laço de travas ordenado por `pecaId`
 *   evita a maior parte dos deadlocks, mas não todos (pooler de conexão,
 *   outra rota tocando a mesma linha) — o retry é a rede.
 * - `P2034`: "write conflict or a deadlock" — inequívoco pelo código.
 */
export function erroDeContencaoTransitoria(erro: unknown): boolean {
  if (!(erro instanceof Prisma.PrismaClientKnownRequestError)) return false;
  if (erro.code === 'P2002') return !colisaoDeRequisicaoJaAberta(erro) && alvoDaViolacao(erro).includes('numero');
  if (erro.code === 'P2010' || erro.code === 'P2039') {
    const sqlstate = (erro.meta as { code?: string } | undefined)?.code ?? causaDoAdapter(erro)?.originalCode;
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
 * A ordem de trava quando a transação toca DUAS linhas de `peca_saldos` da
 * mesma peça — o caso da transferência entre depósitos, e só dele.
 *
 * `compararPorPeca` devolve 0 para esse par, e 0 deixa a ordem ao acaso: duas
 * transferências simultâneas da mesma peça em sentidos opostos (A→B e B→A)
 * travariam em ordens contrárias e esperariam uma pela outra.
 *
 * Por que uma função nova em vez de mudar `compararPorPeca`: os dez chamadores
 * dele travam num depósito só, onde o desempate nunca dispara. Compõem sem
 * ciclo porque os dois ordenam por `pecaId` PRIMEIRO.
 */
export function compararPorPecaEDeposito(
  a: { pecaId: string; depositoId: string },
  b: { pecaId: string; depositoId: string },
): number {
  const porPeca = compararPorPeca(a.pecaId, b.pecaId);
  if (porPeca !== 0) return porPeca;
  return a.depositoId < b.depositoId ? -1 : a.depositoId > b.depositoId ? 1 : 0;
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
 * Segue a ordem única de trava documentada no topo deste arquivo, segundo
 * passo: trava a requisição DEPOIS do cabeçalho da ordem de compra, e ANTES do
 * cabeçalho de inventário ou de transferência.
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
