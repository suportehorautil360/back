import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { normalizarCodigo } from './regras/codigo';
import { Prisma } from '../../prisma/generated/client';
import { disponivel } from './regras/disponibilidade';
import { novoCustoMedio } from './regras/movimento';
import {
  statusAposConsulta,
  statusAposEntrega,
  statusAposSeparacao,
  type StatusMateriais,
} from './regras/status-materiais';
import {
  requisicaoEstaSeparada,
  statusDoItemAposSeparacao,
  temDivergencia,
  validarConferencia,
} from './regras/separacao';
import {
  categoriaECicloExistem,
  itensDeTrocaDoCiclo,
  resolverPeca,
  type ItemDeTroca,
} from './regras/plano-pecas';
import { formatNumeroRequisicao, parseNumeroRequisicaoSeq } from './helpers/numero-requisicao.helper';

export interface ItemReservado {
  linhaId: string;
  pecaId: string | null;
  descricao: string;
  /** Retrato do plano; persistido mesmo quando `pecaId` é nulo (achado C3). */
  codigoPeca: string | null;
  /** Vem do plano ("L", "un"). O painel usa no rótulo "8 de 15 L". */
  unidade: string | null;
  quantidadeSolicitada: number;
  quantidadeReservada: number;
  quantidadeFaltante: number;
  impeditivo: boolean;
  status: 'reservada' | 'faltante' | 'nao_vinculado';
}

export interface ResultadoDaReserva {
  /** `null` quando o ciclo não tem item de troca nenhum (achado I6: nada é gravado). */
  requisicaoId: string | null;
  numero: string | null;
  statusMateriais: StatusMateriais;
  itens: ItemReservado[];
}

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
const MAX_TENTATIVAS_CONCORRENCIA = 5;

/**
 * Nome do índice único parcial que garante NO MÁXIMO uma requisição aberta
 * por OS (migration `20260912195000_requisicao_unica_por_os`). Não existe
 * em `schema.prisma` — Prisma não expressa índice parcial (`WHERE`), mesma
 * situação de `operator_salario_vigente_key` em `OperatorSalario`.
 */
const INDICE_REQUISICAO_UNICA_POR_OS = 'requisicoes_material_uma_aberta_por_os';

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
function alvoDaViolacao(erro: Prisma.PrismaClientKnownRequestError): string {
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
function colisaoDeRequisicaoJaAberta(erro: unknown): boolean {
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
function erroDeContencaoTransitoria(erro: unknown): boolean {
  if (!(erro instanceof Prisma.PrismaClientKnownRequestError)) return false;
  if (erro.code === 'P2002') return !colisaoDeRequisicaoJaAberta(erro) && alvoDaViolacao(erro).includes('numero');
  if (erro.code === 'P2010') {
    const sqlstate = (erro.meta as { code?: string } | undefined)?.code;
    return sqlstate === '40P01' || sqlstate === '40001';
  }
  if (erro.code === 'P2034') return true;
  return false;
}

/** A requisição com seus itens — o que `separarItens` lê antes de decidir. */
type RequisicaoComItens = Prisma.RequisicaoMaterialGetPayload<{ include: { itens: true } }>;

/** Um item já validado (`validarConferencia`) e pronto para a transação. */
interface PlanoDeSeparacao {
  item: RequisicaoComItens['itens'][number];
  quantidade: number;
  /**
   * O valor CRU do pedido — `undefined` quando o campo não veio no corpo.
   * Resolvido contra o item FRESCO só dentro da transação, por
   * `resolverDivergencia` (achado Important I2 da revisão da Task 5).
   */
  divergenciaInformada: string | null | undefined;
}

/**
 * Achado Important I2 da revisão da Task 5: campo ausente no pedido tem que
 * significar "não mexer", não "apagar". `divergencia?: string | null` no
 * DTO existe justamente para essa distinção: sem o campo (`undefined`), uma
 * reconferência (ex.: só ajustando quantidade) não pode zerar uma
 * divergência já registrada por engano — isso tornaria "divergência impede
 * a liberação" contornável por omissão. Para apagar de propósito, o corpo
 * tem que mandar `divergencia: null` explicitamente.
 */
function resolverDivergencia(
  atual: string | null,
  informada: string | null | undefined,
): string | null {
  if (informada === undefined) return atual;
  if (informada === null) return null;
  const limpa = informada.trim();
  return limpa.length > 0 ? limpa : null;
}

/** Os status que ainda dão trabalho ao almoxarife. */
const STATUS_NA_FILA = ['pendente', 'em_separacao', 'separada'] as const;
const STATUS_REQUISICAO = [...STATUS_NA_FILA, 'entregue', 'cancelada'] as const;

@Injectable()
export class AlmoxarifadoService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Uma busca só para os dois códigos.
   *
   * Devolve LISTA porque `codigo_fabricante` não é único: duas marcas
   * equivalentes repetem part number, e escolher uma por conta própria
   * entregaria a peça errada.
   */
  async buscarPorCodigo(companyId: string, codigo: string) {
    const alvo = normalizarCodigo(codigo);
    if (!alvo) return [];
    return this.prisma.peca.findMany({
      where: {
        companyId,
        ativo: true,
        OR: [{ codigoInterno: alvo }, { codigoFabricante: alvo }],
      },
      include: { saldos: { include: { deposito: true } } },
      orderBy: { descricao: 'asc' },
      take: 20,
    });
  }

  /**
   * Reserva o que existe e marca o que falta, numa transação só.
   *
   * `SELECT … FOR UPDATE` na linha de `peca_saldos` é a regra inteira: ler o
   * saldo, decidir e gravar em chamadas separadas deixa duas OS abertas no mesmo
   * segundo contarem com a mesma última unidade — que é justamente o que a
   * "regra de concorrência" do spec proíbe.
   *
   * A reserva NUNCA nasce no aparelho. O app enfileira a intenção; quem decide
   * quem fica com a última unidade é este método, no instante em que o pedido
   * chega.
   */
  async reservarParaOs(
    input: {
      companyId: string;
      serviceOrderId: string;
      depositoId: string;
      autorCompanyUserId: string;
      categoriaPlanoId: string;
      cicloId: string;
    },
    /**
     * Só para teste: injeta os itens já resolvidos e pula a leitura do plano.
     * Em produção NUNCA é passado — quem resolve o plano é este método.
     */
    override?: { itensDoPlano: ItemDeTroca[] },
  ): Promise<ResultadoDaReserva> {
    // Achado Important I2: confere posse do depósito ANTES de qualquer
    // leitura de plano ou abertura de transação. Sem isso, um `depositoId`
    // de outra empresa fazia a reserva não achar linha de saldo nenhuma
    // (tudo virava "falta") e AINDA criava a requisição apontando pra lá —
    // `requisicoes_material` não tem o gatilho de mesma-empresa que
    // `peca_saldos` tem; e um `depositoId` inexistente estourava `P2003`
    // (FK) no meio da transação, um 500 cru sem explicação nenhuma.
    await this.validarDeposito(input.companyId, input.depositoId);

    const itens = override?.itensDoPlano ?? (await this.itensDoPlanoDaOs(input));

    if (itens.length === 0) {
      // Achado Important I6: ciclo sem NENHUM item de troca não cria
      // requisição vazia. `regras/status-materiais.ts` já diz em voz alta
      // que "pôr um kit vazio na fila do almoxarife é ruído" — mas antes
      // desta correção o método gerava número, criava a linha em
      // `requisicoes_material` com zero itens e status `pendente` mesmo
      // assim, entrando na fila do almoxarife enquanto a OS ia para
      // liberada. Sem transação: não há `peca_saldos` para travar nem
      // número de requisição para gastar à toa.
      const statusMateriais = statusAposConsulta([]);
      await this.atualizarStatusMateriaisDaOs(
        this.prisma, input.serviceOrderId, input.companyId, statusMateriais,
      );
      return { requisicaoId: null, numero: null, statusMateriais, itens: [] };
    }

    // A transação inteira é a unidade de retry, não só o INSERT do número.
    // Depois de um erro o Postgres marca a transação como abortada (todo
    // comando seguinte, mesmo um novo INSERT, falharia com "current
    // transaction is aborted") — não dá para só tentar de novo uma parte
    // dentro do mesmo `tx`. Refazer a transação do zero é seguro: o rollback
    // automático do Prisma já liberou os locks de `peca_saldos`, e a nova
    // tentativa relê o saldo (possivelmente mudado por quem venceu a
    // corrida) e recalcula tudo — inclusive o próximo número — do zero.
    for (let tentativa = 1; tentativa <= MAX_TENTATIVAS_CONCORRENCIA; tentativa++) {
      try {
        return await this.prisma.$transaction((tx) =>
          this.executarReserva(tx, input, itens),
        );
      } catch (erro) {
        // Achado Important R1: a colisão no índice de requisição-única-por-OS
        // não é contenção transitória — é a MESMA regra de negócio do achado
        // I3 (a checagem de aplicação, que é TOCTOU sob concorrência de
        // verdade), só que pega no banco. Propaga na hora, ANTES de checar
        // `erroDeContencaoTransitoria`: tentar de novo não resolveria nada
        // (a OS sempre vai ter a requisição da outra transação) e gastaria
        // as `MAX_TENTATIVAS_CONCORRENCIA` travando `peca_saldos` à toa.
        if (colisaoDeRequisicaoJaAberta(erro)) {
          throw new ConflictException(
            'Esta OS já tem uma requisição de material em aberto — a reserva não pode ser repetida.',
          );
        }
        if (!erroDeContencaoTransitoria(erro) || tentativa === MAX_TENTATIVAS_CONCORRENCIA) {
          if (erroDeContencaoTransitoria(erro)) {
            throw new ConflictException(
              `Não foi possível concluir a reserva após ` +
                `${MAX_TENTATIVAS_CONCORRENCIA} tentativas por contenção — tente novamente.`,
            );
          }
          throw erro;
        }
        // volta pro topo do for: recalcula número e relê saldo do zero.
      }
    }
    // Inalcançável: o loop acima sempre retorna ou lança. Só aqui pro TS
    // aceitar que a função tem um valor de retorno em todo caminho.
    throw new ConflictException('Não foi possível concluir a reserva.');
  }

  /**
   * O corpo da transação de `reservarParaOs`, isolado para poder ser
   * chamado de novo em caso de retry (ver `MAX_TENTATIVAS_CONCORRENCIA`).
   * Só é chamado com `itens` não-vazio — o caso vazio retorna cedo antes de
   * abrir transação (achado I6).
   */
  private async executarReserva(
    tx: Prisma.TransactionClient,
    input: {
      companyId: string;
      serviceOrderId: string;
      depositoId: string;
      autorCompanyUserId: string;
    },
    itens: ItemDeTroca[],
  ): Promise<ResultadoDaReserva> {
    // Achado Important I3: clique repetido DEPOIS que a resposta já chegou
    // (o `IdempotencyInterceptor` nas rotas cobre o retry de rede da MESMA
    // requisição HTTP; isto cobre uma SEGUNDA requisição distinta pedindo
    // reserva de novo para a mesma OS). Sem isto, nada impedia chamar de
    // novo: criava-se uma segunda requisição e reservava-se o saldo outra
    // vez — a MESMA OS ficando com o dobro comprometido, e a OS seguinte
    // recebendo falta por saldo que na verdade não foi consumido duas vezes
    // de verdade. `cancelada` não conta: uma requisição cancelada não pode
    // travar uma nova tentativa legítima.
    const existente = await tx.requisicaoMaterial.findFirst({
      where: { serviceOrderId: input.serviceOrderId, status: { not: 'cancelada' } },
      select: { id: true },
    });
    if (existente) {
      throw new ConflictException(
        'Esta OS já tem uma requisição de material em aberto — a reserva não pode ser repetida.',
      );
    }

    // Achado Important I1: trava `peca_saldos` SEMPRE na mesma ordem — por
    // `pecaId` — entre chamadas concorrentes. O laço original travava na
    // ordem do PLANO; duas OS de categorias diferentes que compartilhem uma
    // peça (um filtro de óleo comum a duas listas) em ordens opostas do
    // plano se travavam mutuamente, e o Postgres mata uma delas com
    // `40P01` (deadlock) — que não é `P2002`, e sem tratamento propagava
    // como 500 cru: sem falta, sem reserva, sem explicação. A ordem do
    // PLANO é preservada na RESPOSTA (é o que a tela mostra) via
    // `indiceOriginal`.
    const ordemDeTrava = itens
      .map((item, indiceOriginal) => ({ item, indiceOriginal }))
      .sort((a, b) => {
        const pa = a.item.pecaId ?? '';
        const pb = b.item.pecaId ?? '';
        return pa < pb ? -1 : pa > pb ? 1 : 0;
      });

    const resultado: ItemReservado[] = new Array(itens.length);

    for (const { item, indiceOriginal } of ordemDeTrava) {
      if (!item.pecaId) {
        resultado[indiceOriginal] = {
          linhaId: item.linhaId, pecaId: null, descricao: item.descricao,
          codigoPeca: item.codigoPeca, unidade: item.unidade,
          quantidadeSolicitada: item.quantidade, quantidadeReservada: 0,
          quantidadeFaltante: item.quantidade, impeditivo: item.impeditivo,
          status: 'nao_vinculado',
        };
        continue;
      }

      const linhas = await tx.$queryRaw<
        { saldo_fisico: string; saldo_reservado: string }[]
      >(Prisma.sql`
        SELECT saldo_fisico, saldo_reservado
          FROM peca_saldos
         WHERE peca_id = ${item.pecaId}::uuid
           AND deposito_id = ${input.depositoId}::uuid
           FOR UPDATE
      `);

      const saldo = linhas[0]
        ? {
            saldoFisico: Number(linhas[0].saldo_fisico),
            saldoReservado: Number(linhas[0].saldo_reservado),
            saldoSeparado: 0,
            saldoEmCompra: 0,
          }
        : null;

      const livre = saldo ? disponivel(saldo) : 0;
      const reservar = Math.min(livre, item.quantidade);
      const faltante = item.quantidade - reservar;

      if (reservar > 0) {
        await tx.$executeRaw(Prisma.sql`
          UPDATE peca_saldos
             SET saldo_reservado = saldo_reservado + ${reservar},
                 updated_at = now()
           WHERE peca_id = ${item.pecaId}::uuid
             AND deposito_id = ${input.depositoId}::uuid
        `);
      }

      resultado[indiceOriginal] = {
        linhaId: item.linhaId, pecaId: item.pecaId, descricao: item.descricao,
        codigoPeca: item.codigoPeca, unidade: item.unidade,
        quantidadeSolicitada: item.quantidade, quantidadeReservada: reservar,
        quantidadeFaltante: faltante, impeditivo: item.impeditivo,
        status: faltante > 0 ? 'faltante' : 'reservada',
      };
    }

    const numero = await this.proximoNumeroRequisicao(tx, input.companyId);
    const req = await tx.requisicaoMaterial.create({
      data: {
        companyId: input.companyId,
        numero,
        serviceOrderId: input.serviceOrderId,
        depositoId: input.depositoId,
        solicitanteCompanyUserId: input.autorCompanyUserId,
      },
      select: { id: true, numero: true },
    });

    // Achado Critical C3 da revisão: item `nao_vinculado` (pecaId nulo) É
    // GRAVADO, não pulado — sumir da tabela é o que fazia um plano cuja
    // ÚNICA linha de troca ficasse sem peça resolvida liberar a OS para
    // execução como se estivesse tudo certo. `descricao`/`codigoPeca`
    // (migration `20260912185000_item_sem_peca_vinculada`) são o retrato do
    // que o PLANO sabia sobre a linha no momento da reserva, gravado para
    // TODO item (não só o não vinculado): o catálogo muda depois, o retrato
    // da reserva não deveria — mesma razão de `ServiceOrder.equipmentNome`/
    // `equipmentPlaca` guardarem o snapshot do equipamento.
    for (const r of resultado) {
      await tx.requisicaoMaterialItem.create({
        data: {
          requisicaoId: req.id,
          pecaId: r.pecaId,
          descricao: r.descricao,
          codigoPeca: r.codigoPeca,
          planoLinhaId: r.linhaId,
          quantidadeSolicitada: r.quantidadeSolicitada,
          quantidadeReservada: r.quantidadeReservada,
          impeditivo: r.impeditivo,
          status: r.status,
        },
      });
    }

    // TODOS os itens, inclusive `nao_vinculado` — filtrar por `pecaId` antes
    // de chegar aqui é o que fazia `statusAposConsulta` nunca ver o item sem
    // peça resolvida e devolver `liberada_para_execucao` por engano.
    const statusMateriais = statusAposConsulta(
      resultado.map((r) => ({ impeditivo: r.impeditivo, status: r.status })),
    );

    await this.atualizarStatusMateriaisDaOs(tx, input.serviceOrderId, input.companyId, statusMateriais);

    return { requisicaoId: req.id, numero: req.numero, statusMateriais, itens: resultado };
  }

  /**
   * Confere que o depósito existe, pertence à empresa e está ativo — ANTES
   * de qualquer leitura de plano ou abertura de transação (achado Important
   * I2). Chamado pelos dois métodos que recebem `depositoId` do corpo.
   */
  private async validarDeposito(companyId: string, depositoId: string): Promise<void> {
    const deposito = await this.prisma.deposito.findFirst({
      where: { id: depositoId, companyId, ativo: true },
      select: { id: true },
    });
    if (!deposito) throw new NotFoundException('Depósito não encontrado.');
  }

  /**
   * Grava `statusMateriais` só se a OS pertencer à empresa — achado
   * Important I4. `update({ where: { id } })` grava por id GLOBAL; a
   * validação de posse que `itensDoPlanoDaOs` faz é comportamental (mora
   * numa função que `override` pula inteira). `updateMany` com `companyId`
   * no `where` torna a escrita cruzando empresa ESTRUTURALMENTE impossível,
   * por qualquer caminho de chamada — `count` fica 0 e nada é escrito.
   */
  private async atualizarStatusMateriaisDaOs(
    client: PrismaService | Prisma.TransactionClient,
    serviceOrderId: string,
    companyId: string,
    statusMateriais: StatusMateriais,
  ): Promise<void> {
    const atualizado = await client.serviceOrder.updateMany({
      where: { id: serviceOrderId, companyId },
      data: { statusMateriais },
    });
    if (atualizado.count === 0) {
      throw new NotFoundException('OS não encontrada para esta empresa.');
    }
  }

  /**
   * Os itens de troca do ciclo, com a peça já resolvida contra o catálogo.
   *
   * Lê o plano do MODELO do equipamento da OS, como `getPlanoParaModelo` faz no
   * painel. Fora da transação de propósito: é leitura, e prender a linha do
   * saldo enquanto se lê um Json não ajuda ninguém.
   *
   * A checagem de posse (`companyId` no `findFirst` + `NotFoundException` se
   * vier vazio) segue o padrão de `mecanica.service.ts`
   * (`relatosDoOperador`, entre outros). Note que esta é a validação de posse
   * da OS especificamente — a de `depositoId` (achado I2) mora em
   * `validarDeposito` e roda antes desta, e a de `companyId` no UPDATE final
   * (achado I4) mora em `atualizarStatusMateriaisDaOs`: são três camadas
   * independentes, nenhuma torna as outras duas dispensáveis.
   */
  private async itensDoPlanoDaOs(input: {
    companyId: string;
    serviceOrderId: string;
    categoriaPlanoId: string;
    cicloId: string;
  }): Promise<ItemDeTroca[]> {
    const os = await this.prisma.serviceOrder.findFirst({
      where: { id: input.serviceOrderId, companyId: input.companyId },
      select: { equipment: { select: { modelo: true } } },
    });
    if (!os) throw new NotFoundException('OS não encontrada.');

    const plano = await this.prisma.planoPreventivo.findFirst({
      where: { companyId: input.companyId, modelo: os.equipment?.modelo ?? 'Geral' },
      select: { categorias: true },
    });

    // Achado Important R3: `itensDeTrocaDoCiclo` devolve `[]` tanto para
    // "ciclo existe e não tem item de troca" (legítimo — ciclo só de
    // inspeção, segue para liberar) quanto para "categoria ou ciclo não
    // existem no plano" (erro de quem chamou — um id com typo). Sem esta
    // checagem, o segundo caso caía no mesmo caminho do I6 (retorno cedo,
    // sem transação) e carimbava a OS como `liberada_para_execucao` em
    // silêncio — um `cicloId` errado liberava a ordem para a bancada. A
    // distinção mora aqui (quem orquestra), não em `regras/plano-pecas.ts`
    // (módulo puro — devolver `[]` para entrada inválida é o comportamento
    // CORRETO dele).
    const { categoriaExiste, cicloExiste } = categoriaECicloExistem(
      plano?.categorias, input.categoriaPlanoId, input.cicloId,
    );
    if (!categoriaExiste) {
      throw new BadRequestException(
        `Categoria "${input.categoriaPlanoId}" não encontrada no plano preventivo.`,
      );
    }
    if (!cicloExiste) {
      throw new BadRequestException(
        `Ciclo "${input.cicloId}" não encontrado no plano preventivo.`,
      );
    }

    const brutos = itensDeTrocaDoCiclo(
      plano?.categorias, input.categoriaPlanoId, input.cicloId,
    );
    if (brutos.length === 0) return []; // ciclo existe, sem item de troca — legítimo (I6 libera direto)

    const catalogo = await this.prisma.peca.findMany({
      where: { companyId: input.companyId, ativo: true },
      select: { id: true, codigoInterno: true, codigoFabricante: true },
    });
    // `ItemDeTroca.pecaId`/`codigoPeca` são `string | null`; `resolverPeca`
    // (regras/plano-pecas.ts, não alterado) pede `string | undefined` — o
    // brief passava `i` direto e não compila sob `strictNullChecks` (só não
    // pega no `jest` porque `isolatedModules: true` no tsconfig desliga o
    // type-check ali). `texto()` trata `null` e `undefined` da mesma forma
    // (`typeof v === 'string' ? … : ''`), então a conversão é só de tipo.
    return brutos.map((i) => ({
      ...i,
      pecaId: resolverPeca(
        { pecaId: i.pecaId ?? undefined, codigoPeca: i.codigoPeca ?? undefined },
        catalogo,
      ),
    }));
  }

  /**
   * `REQ-2026-001`. MAX+1 por empresa, igual ao protocolo de OS. NÃO evita
   * colisão sozinho — o `@@unique([companyId, numero])` só a DETECTA; quem
   * absorve é o retry em `reservarParaOs` (`MAX_TENTATIVAS_CONCORRENCIA`).
   *
   * Achado Critical C1 da revisão: a versão anterior achava "o último" com
   * `orderBy: { numero: 'desc' }` — MAX **lexicográfico** numa coluna TEXT.
   * A partir de `REQ-2026-999`, `REQ-2026-1000` (que só existe DEPOIS de
   * `n = 1000` ser calculado e a requisição criada) fica ATRÁS de `999`
   * nessa ordem (`'9' > '1'`), então o "último" aparente trava em `999` para
   * sempre, `n` volta a ser `1000` em toda chamada seguinte, e o
   * `@@unique([companyId, numero])` rejeita a mesma string repetidamente —
   * um `P2002` ETERNO que nem o retry de `reservarParaOs` resolve (esgota as
   * `MAX_TENTATIVAS_CONCORRENCIA` tentativas sempre computando o mesmo
   * número). Mesmo caminho de `nextProtocoloOsPg`
   * (`common/prisma/gerar-protocolo-os-prisma.helper.ts`): busca TODOS os
   * números do ano e tira o maior em NÚMERO, nunca por `ORDER BY` em texto.
   */
  private async proximoNumeroRequisicao(
    tx: Prisma.TransactionClient,
    companyId: string,
  ): Promise<string> {
    const ano = new Date().getUTCFullYear();
    const prefixo = `REQ-${ano}-`;
    const existentes = await tx.requisicaoMaterial.findMany({
      where: { companyId, numero: { startsWith: prefixo } },
      select: { numero: true },
    });

    let maxSeq = 0;
    for (const { numero } of existentes) {
      const seq = parseNumeroRequisicaoSeq(numero, ano);
      if (seq !== null && seq > maxSeq) maxSeq = seq;
    }

    return formatNumeroRequisicao(ano, maxSeq + 1);
  }

  /**
   * Entrada de peça no depósito.
   *
   * Movimento e saldo na MESMA transação: gravar um sem o outro é o começo de um
   * estoque que não bate, e o CHECK de `saldo_fisico >= 0` é a rede, não a regra.
   *
   * `custoUnit` nulo mantém o custo médio: devolução de sobra volta sem nota, e
   * tratá-la como entrada a custo zero achataria o valor do estoque.
   *
   * Achado Critical C2 da revisão: `FOR UPDATE` não trava linha que NÃO
   * existe. Na primeira carga da prateleira (peça/depósito sem linha de
   * saldo ainda), a versão anterior lia `anterior = 0` em duas entradas
   * simultâneas, as duas calculavam `depois = quantidade`, e o `upsert`
   * gravava um valor ABSOLUTO — a segunda sobrescrevia a primeira, com os
   * DOIS `estoque_movimentos` gravados (razão append-only) e o saldo físico
   * batendo com só uma das duas entradas. Ordem corrigida, no molde de
   * `selarRegistroPostgres` (`common/prisma/ponto-selo.helper.ts`): 1) UPSERT
   * primeiro com `update: {}` — garante a linha (saldo em 0 se for nova) SEM
   * alterar o que já existe; 2) SÓ ENTÃO `SELECT … FOR UPDATE`, que agora
   * trava uma linha garantidamente existente; 3) leitura tipada da linha já
   * travada. Isso serializa a segunda entrada atrás da primeira de verdade.
   */
  async darEntrada(input: {
    companyId: string;
    pecaId: string;
    depositoId: string;
    quantidade: number;
    custoUnit: number | null;
    autorCompanyUserId: string;
    observacao?: string | null;
  }): Promise<{ saldoFisico: number; custoMedio: number }> {
    if (input.quantidade <= 0) {
      throw new BadRequestException('Quantidade tem de ser maior que zero.');
    }
    // Achado Important I2: mesma checagem de posse do depósito que a
    // reserva faz, pelas mesmas duas razões (empresa errada não acha nada
    // de útil; depósito inexistente estoura FK cru dentro da transação).
    await this.validarDeposito(input.companyId, input.depositoId);

    return this.prisma.$transaction(async (tx) => {
      await tx.pecaSaldo.upsert({
        where: { pecaId_depositoId: { pecaId: input.pecaId, depositoId: input.depositoId } },
        create: { pecaId: input.pecaId, depositoId: input.depositoId },
        update: {},
      });
      await tx.$executeRaw(Prisma.sql`
        SELECT 1 FROM peca_saldos
         WHERE peca_id = ${input.pecaId}::uuid
           AND deposito_id = ${input.depositoId}::uuid
           FOR UPDATE
      `);

      const saldo = await tx.pecaSaldo.findUniqueOrThrow({
        where: { pecaId_depositoId: { pecaId: input.pecaId, depositoId: input.depositoId } },
        select: { saldoFisico: true },
      });
      const anterior = Number(saldo.saldoFisico);
      const depois = anterior + input.quantidade;

      const peca = await tx.peca.findFirstOrThrow({
        where: { id: input.pecaId, companyId: input.companyId },
        select: { custoMedio: true },
      });
      const custoMedio = novoCustoMedio(
        Number(peca.custoMedio), anterior, input.quantidade, input.custoUnit,
      );

      await tx.pecaSaldo.update({
        where: { pecaId_depositoId: { pecaId: input.pecaId, depositoId: input.depositoId } },
        data: { saldoFisico: depois },
      });
      await tx.peca.update({
        where: { id: input.pecaId },
        data: { custoMedio },
      });
      await tx.estoqueMovimento.create({
        data: {
          companyId: input.companyId,
          pecaId: input.pecaId,
          depositoId: input.depositoId,
          tipo: 'entrada',
          quantidade: input.quantidade,
          saldoApos: depois,
          custoUnit: input.custoUnit,
          origemTipo: 'ajuste_manual',
          autorCompanyUserId: input.autorCompanyUserId,
          observacao: input.observacao ?? null,
        },
      });

      return { saldoFisico: depois, custoMedio };
    });
  }

  /**
   * A conferência do kit pelo almoxarife.
   *
   * Mexe em `saldo_separado`, não em `saldo_fisico`: a peça continua no
   * depósito, só que agora dentro de uma caixa com o nome da OS. O físico só
   * cai na entrega (Task 6).
   *
   * `saldo_separado <= saldo_reservado` é CHECK no banco — a validação pura
   * (`validarConferencia`) existe para devolver mensagem em vez de 500, e
   * roda ANTES de abrir transação: recusar no meio deixaria metade do kit
   * conferido e metade não, e o almoxarife não saberia onde parou.
   */
  async separarItens(input: {
    companyId: string;
    requisicaoId: string;
    autorCompanyUserId: string;
    itens: Array<{ itemId: string; quantidade: number; divergencia?: string | null }>;
  }): Promise<{ statusRequisicao: string; statusMateriais: StatusMateriais }> {
    const req = await this.prisma.requisicaoMaterial.findFirst({
      where: { id: input.requisicaoId, companyId: input.companyId },
      include: { itens: true },
    });
    if (!req) throw new NotFoundException('Requisição não encontrada para esta empresa.');
    if (req.status === 'entregue' || req.status === 'cancelada') {
      throw new ConflictException(`Requisição ${req.status} não aceita conferência.`);
    }

    // Achado Critical C1 da revisão: item repetido no MESMO pedido não é uma
    // questão de concorrência entre duas chamadas — é o mesmo defeito de
    // "delta contra leitura obsoleta" (ver `executarSeparacao`), só que
    // disparável com um único POST (`itens: [{it-1,4},{it-1,4}]` dobra
    // `saldo_separado`). Rejeitar aqui é a defesa primária, e roda antes de
    // abrir transação; a releitura dentro dela (mais abaixo) é a segunda
    // camada, para quando duas chamadas DIFERENTES conferem o mesmo item.
    const idsVistos = new Set<string>();
    for (const conferido of input.itens) {
      if (idsVistos.has(conferido.itemId)) {
        throw new BadRequestException(
          `Item ${conferido.itemId} repetido no mesmo pedido de conferência.`,
        );
      }
      idsVistos.add(conferido.itemId);
    }

    // Valida TUDO antes de abrir transação: recusar no meio deixaria metade
    // do kit conferido e metade não, e o almoxarife não saberia onde parou.
    const porId = new Map(req.itens.map((i) => [i.id, i]));
    const planejado: PlanoDeSeparacao[] = [];
    for (const conferido of input.itens) {
      const item = porId.get(conferido.itemId);
      if (!item) {
        // Sem isto, um itemId de outra requisição faria o saldo de outra OS
        // mexer — a linha de saldo é achada por `pecaId`, não por `itemId`.
        throw new BadRequestException(`Item ${conferido.itemId} não é desta requisição.`);
      }
      const v = validarConferencia(
        {
          quantidadeReservada: Number(item.quantidadeReservada),
          status: item.status,
          impeditivo: item.impeditivo,
          divergencia: item.divergencia,
        },
        { quantidade: conferido.quantidade },
      );
      if (!v.ok) throw new BadRequestException(v.erro);
      // Achado Important I2: `divergencia` do pedido só é resolvida DENTRO
      // da transação (`resolverDivergencia`), contra o valor FRESCO do item —
      // aqui só carregamos o que veio informado, sem decidir nada ainda.
      planejado.push({ item, quantidade: v.quantidade, divergenciaInformada: conferido.divergencia });
    }

    // Achado Important I4: mesma rede de contenção da reserva
    // (`erroDeContencaoTransitoria` já existe no arquivo, para retry de
    // deadlock/serialização). Sem isto, um `40001`/`P2034` na trava de
    // `peca_saldos` chegava ao cliente como 500 cru.
    for (let tentativa = 1; tentativa <= MAX_TENTATIVAS_CONCORRENCIA; tentativa++) {
      try {
        return await this.prisma.$transaction((tx) => this.executarSeparacao(tx, input, req, planejado));
      } catch (erro) {
        if (!erroDeContencaoTransitoria(erro) || tentativa === MAX_TENTATIVAS_CONCORRENCIA) {
          if (erroDeContencaoTransitoria(erro)) {
            throw new ConflictException(
              `Não foi possível concluir a separação após ` +
                `${MAX_TENTATIVAS_CONCORRENCIA} tentativas por contenção — tente novamente.`,
            );
          }
          throw erro;
        }
        // volta pro topo do for: a próxima tentativa releva tudo do zero
        // dentro de `executarSeparacao` — inclusive o estado dos itens.
      }
    }
    // Inalcançável: o loop acima sempre retorna ou lança. Só aqui pro TS
    // aceitar que a função tem um valor de retorno em todo caminho.
    throw new ConflictException('Não foi possível concluir a separação.');
  }

  /**
   * O corpo da transação de `separarItens`, isolado para poder ser chamado
   * de novo em caso de retry (ver `MAX_TENTATIVAS_CONCORRENCIA`).
   */
  private async executarSeparacao(
    tx: Prisma.TransactionClient,
    input: { companyId: string; autorCompanyUserId: string },
    req: RequisicaoComItens,
    planejado: PlanoDeSeparacao[],
  ): Promise<{ statusRequisicao: string; statusMateriais: StatusMateriais }> {
    // Achado Important I1 da reserva, válido aqui pela mesma razão: trava
    // `peca_saldos` SEMPRE na mesma ordem — por `pecaId` — entre chamadas
    // concorrentes. Duas conferências simultâneas travando as mesmas linhas
    // em ordens opostas dão deadlock (`40P01`), que não é `P2002`.
    const ordemDeTrava = [...planejado].sort((a, b) => {
      const pa = a.item.pecaId ?? '';
      const pb = b.item.pecaId ?? '';
      return pa < pb ? -1 : pa > pb ? 1 : 0;
    });

    for (const p of ordemDeTrava) {
      // Item `nao_vinculado` não tem `pecaId` — nenhuma linha de saldo para
      // travar ou mexer. Na prática é inalcançável (`validarConferencia`
      // recusa `nao_vinculado` antes de chegar aqui, e só item sem `pecaId`
      // fica `nao_vinculado`), mas o `continue` documenta a decisão.
      if (!p.item.pecaId) continue;

      const linhas = await tx.$queryRaw<{ saldo_separado: string }[]>(Prisma.sql`
        SELECT saldo_separado FROM peca_saldos
         WHERE peca_id = ${p.item.pecaId}::uuid
           AND deposito_id = ${req.depositoId}::uuid
           FOR UPDATE
      `);
      // Achado Important M1: `FOR UPDATE` não trava linha que não existe —
      // sem linha, `linhas[0]` vem vazio. Isso deveria ser impossível (um
      // item só chega a `status: 'reservada'`, a única porta que passa em
      // `validarConferencia`, quando `reservarParaOs` conseguiu gravar
      // `saldo_reservado > 0`, o que exige a linha já existir naquele
      // momento). Falhar alto é melhor que silenciar: tratar como zero
      // deixaria o `UPDATE` abaixo casar zero linhas (sem erro nenhum — o
      // CHECK só vale para linha que É escrita) enquanto o item já teria
      // sido marcado como separado, um estado inconsistente sem alerta.
      if (!linhas[0]) {
        throw new Error(
          `Saldo não encontrado para peça ${p.item.pecaId} no depósito ${req.depositoId} ` +
            `ao separar — estado inconsistente com a reserva.`,
        );
      }

      // Achado Critical C1: relê o item AQUI, depois da trava — nunca o
      // retrato de fora da transação (`p.item`). Em READ COMMITTED, este
      // `findUniqueOrThrow` enxerga o último commit, inclusive de uma
      // segunda chamada que já tenha separado este mesmo item enquanto
      // esta transação esperava a trava de `peca_saldos`.
      const itemFresco = await tx.requisicaoMaterialItem.findUniqueOrThrow({
        where: { id: p.item.id },
      });
      const delta = p.quantidade - Number(itemFresco.quantidadeSeparada);

      if (delta !== 0) {
        // Aritmética RELATIVA no banco — não "leia, some em JS, grave
        // absoluto". É a mesma classe do Critical C2 de `darEntrada`
        // (lá era `saldo_fisico`, aqui é `saldo_separado`): somar no
        // Postgres, sob a trava, é atômico mesmo que a leitura anterior não
        // tivesse sido a mais recente possível — a soma nunca se perde.
        await tx.$executeRaw(Prisma.sql`
          UPDATE peca_saldos
             SET saldo_separado = saldo_separado + ${delta}, updated_at = now()
           WHERE peca_id = ${p.item.pecaId}::uuid
             AND deposito_id = ${req.depositoId}::uuid
        `);
      }

      // Achado Important I2: campo ausente no pedido ("não mexer") é
      // diferente de `divergencia: null` explícito ("apagar") — decidido
      // aqui contra o valor FRESCO (`itemFresco.divergencia`), não o de
      // fora da transação.
      const divergencia = resolverDivergencia(itemFresco.divergencia, p.divergenciaInformada);

      await tx.requisicaoMaterialItem.update({
        where: { id: p.item.id },
        data: {
          quantidadeSeparada: p.quantidade,
          divergencia,
          status: statusDoItemAposSeparacao(
            {
              quantidadeReservada: Number(p.item.quantidadeReservada),
              status: itemFresco.status,
              impeditivo: p.item.impeditivo,
              divergencia,
            },
            { quantidade: p.quantidade },
          ),
        },
      });
    }

    // Achado Critical C1 (consequência secundária): decide o fechamento com
    // uma releitura de TODOS os itens da requisição — não com `req.itens`,
    // o retrato de fora da transação. Sem isto, duas conferências fechando
    // metades diferentes do mesmo kit cada uma veem a outra metade como
    // ainda `reservada`, e nenhuma das duas chamadas encerra a requisição
    // mesmo com tudo separado no banco.
    const itensFinal = await tx.requisicaoMaterialItem.findMany({
      where: { requisicaoId: req.id },
    });
    const paraRegra = itensFinal.map((i) => ({
      quantidadeReservada: Number(i.quantidadeReservada),
      status: i.status,
      impeditivo: i.impeditivo,
      divergencia: i.divergencia,
    }));

    // Divergência impede o kit de fechar, mesmo com tudo conferido (spec
    // funcional, pág. 6: "divergência impede a liberação").
    const fechado = requisicaoEstaSeparada(paraRegra) && !temDivergencia(paraRegra);
    const statusRequisicao = fechado ? 'separada' : 'em_separacao';

    await tx.requisicaoMaterial.update({
      where: { id: req.id },
      data: {
        status: statusRequisicao,
        atendidaPorCompanyUserId: input.autorCompanyUserId,
        // Achado Important M2: autor sem carimbo de tempo é meia auditoria.
        // Gravado em toda chamada (parcial ou não) — é "quem/quando mexeu
        // por último", não um dos três atos que FECHAM a requisição
        // (aqueles são `liberadaEm`/`entregueEm`/`canceladaEm`, de outras
        // tasks).
        atendidaEm: new Date(),
      },
    });

    // Achado Important I1 (deste review — nome repetido, achado diferente
    // do I1 da reserva citado acima): o override de divergência só pode
    // valer quando `statusAposSeparacao` JÁ fecharia o kit. Sem o `base ===
    // 'materiais_separados'`, uma OS com item FALTANTE mais uma divergência
    // qualquer reportaria `aguardando_separacao` em vez de
    // `aguardando_compra`, e o fluxo de compra nunca seria acionado.
    const base = statusAposSeparacao(paraRegra.map((i) => ({ impeditivo: i.impeditivo, status: i.status })));
    const statusMateriais = temDivergencia(paraRegra) && base === 'materiais_separados' ? 'aguardando_separacao' : base;

    await this.atualizarStatusMateriaisDaOs(tx, req.serviceOrderId, input.companyId, statusMateriais);

    // Task 8: quando `statusRequisicao === 'separada'`, é aqui que entra a
    // chamada a `notificarKitCompleto` — o kit acabou de fechar.

    return { statusRequisicao, statusMateriais };
  }

  /**
   * O almoxarife diz que o kit está pronto e a OS pode andar.
   *
   * Ato EXPLÍCITO, e não consequência automática da conferência: separar é
   * trabalho de prateleira, liberar é a pessoa assumindo que o kit confere. O
   * spec funcional separa os dois passos (7 e 8) pela mesma razão.
   *
   * Não mexe em `peca_saldos` nem no razão do estoque — por isso, ao
   * contrário de `entregarRequisicao`, não há laço de retry por contenção
   * aqui: sem `SELECT … FOR UPDATE`, não existe o `40001`/`40P01` que só
   * aparece em raw query (ver `erroDeContencaoTransitoria`). As únicas
   * escritas são no próprio registro da requisição e no `statusMateriais` da
   * OS — sem disputa por linha de saldo.
   */
  async liberarRequisicao(input: {
    companyId: string;
    requisicaoId: string;
    autorCompanyUserId: string;
  }): Promise<{ statusMateriais: StatusMateriais }> {
    const req = await this.prisma.requisicaoMaterial.findFirst({
      where: { id: input.requisicaoId, companyId: input.companyId },
      include: {
        itens: true,
        deposito: { select: { nome: true } },
        // A notificação da Task 8 precisa destes quatro campos. Carregar
        // aqui, numa consulta que já acontece de qualquer forma, evita uma
        // segunda ida ao banco DENTRO da transação — onde ela seguraria a
        // trava por mais tempo à toa.
        serviceOrder: {
          select: {
            protocolo: true,
            equipmentId: true,
            equipmentNome: true,
            responsavelOperatorId: true,
          },
        },
      },
    });
    if (!req) throw new NotFoundException('Requisição não encontrada para esta empresa.');
    if (req.status !== 'separada') {
      throw new ConflictException(
        `Só requisição com kit conferido é liberada — esta está "${req.status}".`,
      );
    }

    return this.prisma.$transaction(async (tx) => {
      await tx.requisicaoMaterial.update({
        where: { id: req.id },
        data: { liberadaEm: new Date(), liberadaPorCompanyUserId: input.autorCompanyUserId },
      });

      // Relê os itens AQUI, dentro da transação — nunca o retrato de fora
      // dela (`req.itens`). É a QUINTA vez que "leu fora da transação,
      // decidiu com o que leu" apareceria nesta frente (entrada de estoque,
      // conferência do kit, duas vezes na entrega, e esta): uma conferência
      // concorrente (`separarItens` aceita chamadas mesmo com
      // `status: 'separada'`) pode mudar o status de um item entre a
      // leitura de fora e o commit desta transação. O que sai daqui não é
      // saldo, mas é o que a bancada do mecânico mostra — `statusMateriais`
      // errado manda buscar um kit que não está pronto.
      const itensFrescos = await tx.requisicaoMaterialItem.findMany({
        where: { requisicaoId: req.id },
      });

      // `statusAposEntrega` responde à MESMA pergunta aqui que na entrega:
      // sobrou pendência de material? Os itens estão `separada`, não
      // `entregue` — mas a função dá a resposta certa do mesmo jeito, porque
      // só distingue `nao_vinculado`/`faltante` do resto. É deliberado (ver o
      // comentário dela em `regras/status-materiais.ts`), não um empréstimo
      // por acaso.
      const paraRegra = itensFrescos.map((i) => ({ impeditivo: i.impeditivo, status: i.status }));
      const statusMateriais = statusAposEntrega(paraRegra);

      await this.atualizarStatusMateriaisDaOs(tx, req.serviceOrderId, input.companyId, statusMateriais);

      // TODO(Task 8): notificar que a OS foi liberada. `notificarOsLiberada`
      // ainda não existe neste módulo — quem escreve é a Task 8. A chamada
      // tem de ficar NA MESMA transação (a liberação dar rollback é pior que
      // não avisar), por isso o lugar já está aqui, comentado, com os dados
      // já carregados acima (req.serviceOrder.*, req.deposito.nome) — sem
      // implementação provisória no meio tempo.
      // await notificarOsLiberada(tx, {
      //   companyId: input.companyId,
      //   serviceOrderId: req.serviceOrderId,
      //   protocolo: req.serviceOrder.protocolo,
      //   equipmentNome: req.serviceOrder.equipmentNome,
      //   equipmentId: req.serviceOrder.equipmentId,
      //   responsavelOperatorId: req.serviceOrder.responsavelOperatorId,
      //   local: req.deposito.nome,
      // });

      return { statusMateriais };
    });
  }

  /**
   * A peça troca de mãos. É a PRIMEIRA operação deste módulo que decrementa
   * `saldo_reservado` — até aqui o sistema só sabia reservar, e é por isso
   * que a feature `suprimentos` está desligada em produção.
   *
   * Três coisas na MESMA transação: o saldo cai, o razão ganha a saída com
   * sinal NEGATIVO, e a OS ganha o `ServiceOrderInsumo` — a tabela que a
   * auditoria de OS já lê. Gravar uma sem as outras é o começo de um estoque
   * que não bate.
   */
  async entregarRequisicao(input: {
    companyId: string;
    requisicaoId: string;
    autorCompanyUserId: string;
    recebedorOperatorId: string;
    confirmacaoTipo: string;
    assinatura?: string | null;
  }): Promise<{ statusMateriais: StatusMateriais }> {
    // Achado m2 da revisão: "assinatura" sem traço nenhum registraria a
    // retirada como se tivesse prova, sem guardar prova nenhuma. Validação de
    // FORMA do pedido — roda antes de qualquer leitura do banco.
    if (input.confirmacaoTipo === 'assinatura' && !(input.assinatura ?? '').trim()) {
      throw new BadRequestException(
        'confirmacaoTipo "assinatura" exige o traço da assinatura.',
      );
    }

    const req = await this.prisma.requisicaoMaterial.findFirst({
      where: { id: input.requisicaoId, companyId: input.companyId },
      include: { itens: true },
    });
    if (!req) throw new NotFoundException('Requisição não encontrada para esta empresa.');
    if (req.status === 'entregue') {
      throw new ConflictException('Esta requisição já foi entregue.');
    }
    if (req.status !== 'separada') {
      throw new ConflictException(
        `Só requisição com kit conferido é entregue — esta está "${req.status}".`,
      );
    }

    // Achado Critical C2 da revisão: o CONJUNTO de candidatos é todo item
    // com peça vinculada que teve ALGUMA reserva — não só os que ficaram
    // `status: 'separada'`. Um item NÃO impeditivo conferido em PARTE (2 de
    // 4) fica em `reservada` de propósito (`statusDoItemAposSeparacao`: meio
    // item não libera meia OS), mas as 2 unidades JÁ foram fisicamente
    // separadas — estão na caixa. Filtrar por `status === 'separada'`
    // deixava essas 2 de fora da entrega para sempre: a requisição fechava
    // como `entregue` (terminal — `separarItens`/`entregarRequisicao`
    // recusam, e o cancelamento da Task 7 não alcança requisição entregue) e
    // as 2 unidades ficavam presas em `saldo_reservado`/`saldo_separado`
    // sem tela nenhuma mostrando por quê.
    //
    // `quantidadeReservada` nunca é escrita depois da criação do item — só
    // `reservarParaOs` a grava — por isso é seguro usar o retrato de fora
    // para decidir QUAIS linhas de `peca_saldos` travar; o quanto entregar
    // ou devolver de cada uma continua sendo lido FRESCO dentro da transação
    // (`executarEntrega`), nunca por um valor pré-calculado aqui fora.
    const candidatos = req.itens.filter((i) => i.pecaId && Number(i.quantidadeReservada) > 0);

    // Mesma rede de contenção da reserva e da separação
    // (`erroDeContencaoTransitoria` já existe no arquivo): sem isto, um
    // `40001`/`P2034` na trava de `peca_saldos` chegaria ao cliente como 500
    // cru.
    for (let tentativa = 1; tentativa <= MAX_TENTATIVAS_CONCORRENCIA; tentativa++) {
      try {
        return await this.prisma.$transaction((tx) => this.executarEntrega(tx, input, req, candidatos));
      } catch (erro) {
        if (!erroDeContencaoTransitoria(erro) || tentativa === MAX_TENTATIVAS_CONCORRENCIA) {
          if (erroDeContencaoTransitoria(erro)) {
            throw new ConflictException(
              `Não foi possível concluir a entrega após ` +
                `${MAX_TENTATIVAS_CONCORRENCIA} tentativas por contenção — tente novamente.`,
            );
          }
          throw erro;
        }
        // volta pro topo do for: a próxima tentativa relê tudo do zero
        // dentro de `executarEntrega` — inclusive o estado dos itens.
      }
    }
    // Inalcançável: o loop acima sempre retorna ou lança. Só aqui pro TS
    // aceitar que a função tem um valor de retorno em todo caminho.
    throw new ConflictException('Não foi possível concluir a entrega.');
  }

  /**
   * O corpo da transação de `entregarRequisicao`, isolado para poder ser
   * chamado de novo em caso de retry (ver `MAX_TENTATIVAS_CONCORRENCIA`).
   */
  private async executarEntrega(
    tx: Prisma.TransactionClient,
    input: {
      companyId: string;
      autorCompanyUserId: string;
      recebedorOperatorId: string;
      confirmacaoTipo: string;
      assinatura?: string | null;
    },
    req: RequisicaoComItens,
    candidatos: RequisicaoComItens['itens'],
  ): Promise<{ statusMateriais: StatusMateriais }> {
    // Mesma ordem ascendente por `pecaId` de `executarReserva` e
    // `executarSeparacao`: travar `peca_saldos` sempre na mesma direção
    // entre chamadas concorrentes evita deadlock (`40P01`) em vez de só
    // detectá-lo depois.
    const ordemDeTrava = [...candidatos].sort((a, b) => {
      const pa = a.pecaId ?? '';
      const pb = b.pecaId ?? '';
      return pa < pb ? -1 : pa > pb ? 1 : 0;
    });

    // Achado m3 da revisão: continua a numeração que a OS já tem — mesmo
    // critério de `itensParaInsumos`/`converterPecasEmInsumos` (orçamento
    // aprovado, `orcamentos/helpers/itens-para-insumos.helper.ts`). Sem
    // isto, todo insumo desta entrega nasceria com `ordem: 0` (default da
    // coluna) e o índice `(service_order_id, ordem)` não ordenaria nada de
    // verdade quando mais de uma peça sai na mesma entrega.
    let proximaOrdem = await tx.serviceOrderInsumo.count({
      where: { serviceOrderId: req.serviceOrderId },
    });

    for (const item of ordemDeTrava) {
      if (!item.pecaId) continue; // inalcançável — `candidatos` já filtra por `pecaId`

      // Trava a linha do saldo ANTES de decidir o que fazer com ela — mesma
      // regra de `executarReserva`/`executarSeparacao`.
      const linhas = await tx.$queryRaw<
        { saldo_fisico: string; saldo_reservado: string; saldo_separado: string }[]
      >(Prisma.sql`
        SELECT saldo_fisico, saldo_reservado, saldo_separado FROM peca_saldos
         WHERE peca_id = ${item.pecaId}::uuid
           AND deposito_id = ${req.depositoId}::uuid
           FOR UPDATE
      `);
      // Achado M1 de `executarSeparacao`, válido aqui pela mesma razão:
      // `FOR UPDATE` não trava linha que não existe. `quantidadeReservada >
      // 0` (o critério de `candidatos`) garante que a linha existia desde a
      // RESERVA — deveria ser impossível não achá-la aqui, tenha o item sido
      // separado ou não. Falhar alto é melhor que silenciar: tratar como
      // zero deixaria o `UPDATE` abaixo casar zero linhas sem erro nenhum,
      // enquanto o item já teria sido marcado como entregue ou cancelado.
      if (!linhas[0]) {
        throw new Error(
          `Saldo não encontrado para peça ${item.pecaId} no depósito ${req.depositoId} ` +
            `ao entregar — estado inconsistente com a reserva.`,
        );
      }

      // Relê o item AQUI, depois da trava — nunca o retrato de fora da
      // transação (`item`, vindo de `candidatos`/`req.itens`). Mesma razão
      // de `executarSeparacao`: sob READ COMMITTED este `findUniqueOrThrow`
      // enxerga o último commit, inclusive de uma chamada concorrente que já
      // tenha fechado este item enquanto esta transação esperava a trava.
      const itemFresco = await tx.requisicaoMaterialItem.findUniqueOrThrow({
        where: { id: item.id },
      });
      if (itemFresco.status === 'entregue' || itemFresco.status === 'cancelada') {
        // Já processado por outra chamada concorrente enquanto esperávamos
        // a trava — nada a fazer de novo com este item.
        continue;
      }
      const reservado = Number(itemFresco.quantidadeReservada);
      const separado = Number(itemFresco.quantidadeSeparada);
      if (reservado <= 0) continue; // defensivo — `candidatos` já garante isto

      // Achado Critical C2: a requisição está FECHANDO — reserva não pode
      // sobreviver a ela. `saldo_reservado` cai pelo total RESERVADO do item
      // (a caixa inteira que existia para ele), não só pelo que foi
      // separado: a diferença (`reservado - separado`) é o que NUNCA chegou
      // a ser conferido, e sem devolvê-la aqui ela fica presa para sempre —
      // a requisição vira `entregue` (terminal) e nada mais vai tocar este
      // item. `saldo_separado`/`saldo_fisico`, por outro lado, só descem
      // pelo que REALMENTE saiu da caixa (`separado`). Aritmética RELATIVA
      // nas três colunas, igual ao resto do arquivo — nunca "leia, some em
      // JS, grave absoluto".
      const fisicoDepois = Number(linhas[0].saldo_fisico) - separado;
      await tx.$executeRaw(Prisma.sql`
        UPDATE peca_saldos
           SET saldo_fisico    = saldo_fisico - ${separado},
               saldo_reservado = saldo_reservado - ${reservado},
               saldo_separado  = saldo_separado  - ${separado},
               updated_at = now()
         WHERE peca_id = ${item.pecaId}::uuid
           AND deposito_id = ${req.depositoId}::uuid
      `);

      if (separado > 0) {
        // Parte (ou tudo) do que foi reservado está fisicamente separado —
        // isso o mecânico leva. O status do item (`separada`, ou ainda
        // `reservada` se a conferência foi parcial) é CONSEQUÊNCIA do que
        // foi conferido, não permissão para entregar: aqui só importa
        // quanto tem na caixa.
        const peca = await tx.peca.findFirstOrThrow({
          where: { id: item.pecaId, companyId: input.companyId },
          select: { custoMedio: true, descricao: true, codigoInterno: true, marca: true, unidade: true },
        });

        await tx.estoqueMovimento.create({
          data: {
            companyId: input.companyId,
            pecaId: item.pecaId,
            depositoId: req.depositoId,
            tipo: 'saida',
            // NEGATIVO: `quantidade` em `estoque_movimentos` é com sinal, e
            // conferir o saldo é um SUM.
            quantidade: -separado,
            saldoApos: fisicoDepois,
            custoUnit: peca.custoMedio,
            origemTipo: 'requisicao',
            origemId: req.id,
            autorCompanyUserId: input.autorCompanyUserId,
          },
        });

        await tx.serviceOrderInsumo.create({
          data: {
            serviceOrderId: req.serviceOrderId,
            ordem: proximaOrdem,
            codigo: peca.codigoInterno,
            descricao: peca.descricao,
            marca: peca.marca,
            quantidade: separado,
            unidade: peca.unidade,
            valorUnit: peca.custoMedio,
          },
        });
        proximaOrdem += 1;

        await tx.requisicaoMaterialItem.update({
          where: { id: item.id },
          data: { quantidadeEntregue: separado, status: 'entregue' },
        });
      } else if (itemFresco.status === 'reservada') {
        // Achado Critical C2: item NÃO impeditivo que ninguém confirmou — a
        // reserva inteira acaba de ser devolvida pelo `UPDATE` acima. Sem
        // movimento de razão nem insumo: nenhuma peça física saiu do
        // depósito. Alternativas descartadas pelo coordenador: inventar um
        // status `entregue_parcial` só adia o problema (o CHECK do banco não
        // tem esse estado), e recusar a entrega por causa de um item não
        // impeditivo trava o mecânico pela exata situação que a regra de
        // impeditivo existe para não travar.
        //
        // `quantidadeReservada` zera junto (achado Critical N1 da 3ª
        // revisão): o `UPDATE` acima já devolveu a reserva ao saldo —
        // deixar o registro dizendo "N reservado" seria mentir sobre o
        // estado do saldo para quem ler este item depois.
        await tx.requisicaoMaterialItem.update({
          where: { id: item.id },
          data: { status: 'cancelada', quantidadeReservada: 0 },
        });
      } else {
        // Único outro caso que chega aqui com `separado === 0`:
        // `itemFresco.status === 'faltante'` — um `faltante` nunca é
        // conferível (`CONFERIVEL` em `regras/separacao.ts` só aceita
        // `reservada`/`separada`), então sua `quantidadeSeparada` nunca sai
        // de 0.
        //
        // Achado Critical N1 da 3ª revisão: `faltante` NESTE MÓDULO
        // significa "falta ALGUMA coisa", não "não tem nada" —
        // `executarReserva` estampa `faltante` COM `quantidadeReservada > 0`
        // sempre que sobra menos do que o solicitado (ex.: 3 de 5
        // disponíveis), sem concorrência nenhuma. Gravar `cancelada` aqui
        // apagava esse `faltante` da releitura fresca que decide
        // `statusMateriais` (`FORA` exclui `cancelada` de `vivos`) — a OS
        // saía `liberada_para_execucao` com peça faltando, o inverso do que
        // a releitura fresca (achado C1) foi corrigida para impedir. O
        // status TEM de continuar `faltante`: é o que a Task 7 (compra e
        // recebimento) lê para saber o que ainda falta comprar.
        //
        // `quantidadeReservada` zera pela mesma razão do outro ramo — a
        // reserva já voltou ao saldo. A necessidade em aberto que a compra
        // cobre é `quantidade_solicitada - quantidade_entregue`, não
        // `quantidade_reservada`; zerada, um faltante parcial e um faltante
        // total passam a ter a mesma forma no banco — a mesma forma que
        // `cancelarRequisicao` já grava para item cancelado.
        await tx.requisicaoMaterialItem.update({
          where: { id: item.id },
          data: { quantidadeReservada: 0 },
        });
      }
    }

    // Achado Important I1 da revisão: `updateMany` condicionado a
    // `status: 'separada'` fecha a corrida entre duas entregas concorrentes.
    // Sem isto, uma segunda chamada que passasse as duas guardas de fora da
    // transação (ambas leem "separada" antes de qualquer uma commitar)
    // sobrescrevia `entregueEm`/`recebedorOperatorId`/`confirmacaoTipo`/
    // `assinatura` com os dados de quem chegou depois — apagando a prova de
    // quem realmente recebeu o kit, e ainda devolvendo 200 para as duas.
    const fechada = await tx.requisicaoMaterial.updateMany({
      where: { id: req.id, status: 'separada' },
      data: {
        status: 'entregue',
        entregueEm: new Date(),
        entreguePorCompanyUserId: input.autorCompanyUserId,
        recebedorOperatorId: input.recebedorOperatorId,
        confirmacaoTipo: input.confirmacaoTipo,
        assinatura: input.assinatura ?? null,
      },
    });
    if (fechada.count === 0) {
      throw new ConflictException('Esta requisição já foi entregue por outra chamada.');
    }

    // Achado Critical C1 (sexta ocorrência nesta frente): relê TODOS os
    // itens da requisição AQUI, dentro da transação — nunca `req.itens`, o
    // retrato de fora dela. Hoje nada grava `faltante` depois da criação do
    // item, mas a Task 7 (compra e recebimento) é candidata óbvia a fazer
    // isso; no dia em que fizer, ler de fora carimbaria
    // `liberada_para_execucao` numa OS com peça faltando, em silêncio. Mesmo
    // critério de `liberarRequisicao` (releitura fresca, quinta ocorrência) e
    // de `executarSeparacao` (releitura de `itensFinal` antes de fechar).
    const itensFrescos = await tx.requisicaoMaterialItem.findMany({
      where: { requisicaoId: req.id },
    });
    const paraRegra = itensFrescos.map((i) => ({ impeditivo: i.impeditivo, status: i.status }));
    const statusMateriais = statusAposEntrega(paraRegra);
    await this.atualizarStatusMateriaisDaOs(tx, req.serviceOrderId, input.companyId, statusMateriais);

    return { statusMateriais };
  }

  /**
   * A válvula de escape.
   *
   * Sem isto, uma OS aberta e abandonada tranca a peça para sempre: a entrega é
   * o único outro caminho que devolve `saldo_reservado`, e OS que ninguém
   * executa nunca chega lá. O índice único parcial
   * `requisicoes_material_uma_aberta_por_os` exclui as canceladas de propósito —
   * cancelar libera a OS para uma reserva nova.
   *
   * Requisição ENTREGUE não é cancelável: a peça já saiu do estoque, e desfazer
   * isso é devolução, que é outra operação (F5) e gera movimento de entrada.
   */
  async cancelarRequisicao(input: {
    companyId: string;
    requisicaoId: string;
    autorCompanyUserId: string;
    motivo: string;
  }): Promise<{ statusMateriais: StatusMateriais }> {
    // Valida ANTES de tocar o banco: o CHECK `req_cancelamento_com_motivo`
    // recusaria de qualquer jeito, mas devolver 500 cru em vez de uma
    // mensagem clara não ajuda quem esqueceu de preencher o motivo.
    const motivo = input.motivo?.trim();
    if (!motivo) {
      throw new BadRequestException('Cancelar requisição exige motivo.');
    }

    // Mesma rede de contenção da reserva, da separação e da entrega
    // (`erroDeContencaoTransitoria` já existe no arquivo): sem isto, um
    // `40001`/`P2034` na trava de `peca_saldos` chegaria ao cliente como 500
    // cru.
    for (let tentativa = 1; tentativa <= MAX_TENTATIVAS_CONCORRENCIA; tentativa++) {
      try {
        return await this.prisma.$transaction((tx) => this.executarCancelamento(tx, input, motivo));
      } catch (erro) {
        if (!erroDeContencaoTransitoria(erro) || tentativa === MAX_TENTATIVAS_CONCORRENCIA) {
          if (erroDeContencaoTransitoria(erro)) {
            throw new ConflictException(
              `Não foi possível concluir o cancelamento após ` +
                `${MAX_TENTATIVAS_CONCORRENCIA} tentativas por contenção — tente novamente.`,
            );
          }
          throw erro;
        }
        // volta pro topo do for: a próxima tentativa relê tudo do zero
        // dentro de `executarCancelamento` — inclusive o status da
        // requisição e o estado dos itens.
      }
    }
    // Inalcançável: o loop acima sempre retorna ou lança. Só aqui pro TS
    // aceitar que a função tem um valor de retorno em todo caminho.
    throw new ConflictException('Não foi possível concluir o cancelamento.');
  }

  /**
   * O corpo da transação de `cancelarRequisicao`, isolado para poder ser
   * chamado de novo em caso de retry (ver `MAX_TENTATIVAS_CONCORRENCIA`).
   */
  private async executarCancelamento(
    tx: Prisma.TransactionClient,
    input: { companyId: string; requisicaoId: string; autorCompanyUserId: string },
    motivo: string,
  ): Promise<{ statusMateriais: StatusMateriais }> {
    // Diferente de `executarReserva`/`executarSeparacao`/`executarEntrega`, a
    // EXISTÊNCIA e o STATUS da requisição são conferidos AQUI DENTRO da
    // transação, não antes dela — mas isto sozinho NÃO fecha a corrida com uma
    // entrega concorrente: não há `isolationLevel` neste `$transaction` (nem
    // em nenhum outro deste arquivo), então o Postgres roda em READ COMMITTED
    // e este `findFirst` enxerga o estado no instante em que roda, ANTES de
    // qualquer `FOR UPDATE` em `peca_saldos`. Quem de fato fecha a janela são
    // as duas guardas PÓS-TRAVA abaixo: o `if (fresco.status === …) continue`
    // por item (espelha `executarEntrega`) e o `updateMany` condicionado ao
    // fechar a requisição — o `throw` deste último desfaz por ROLLBACK
    // qualquer decremento de saldo que o laço já tenha feito antes de
    // descobrir o conflito. O motivo, por não depender de estado nenhum do
    // banco, já foi validado antes do laço de retry, em `cancelarRequisicao`.
    const req = await tx.requisicaoMaterial.findFirst({
      where: { id: input.requisicaoId, companyId: input.companyId },
      include: { itens: true },
    });
    if (!req) throw new NotFoundException('Requisição não encontrada para esta empresa.');
    if (req.status === 'entregue') {
      throw new ConflictException('Requisição entregue não é cancelada — a peça já saiu.');
    }
    if (req.status === 'cancelada') {
      throw new ConflictException('Esta requisição já foi cancelada.');
    }

    const aLiberar = req.itens.filter(
      (i) => i.pecaId && (Number(i.quantidadeReservada) > 0 || Number(i.quantidadeSeparada) > 0),
    );

    // Mesma ordem ascendente por `pecaId` de `executarReserva`,
    // `executarSeparacao` e `executarEntrega`: travar `peca_saldos` sempre na
    // mesma direção entre chamadas concorrentes evita deadlock em vez de só
    // detectá-lo depois. Mesmo comparador dos três — não `localeCompare`, que
    // diverge dele em UUID de case misto e depende do ICU do runtime.
    const ordemDeTrava = [...aLiberar].sort((a, b) => {
      const pa = a.pecaId ?? '';
      const pb = b.pecaId ?? '';
      return pa < pb ? -1 : pa > pb ? 1 : 0;
    });

    for (const item of ordemDeTrava) {
      const linhas = await tx.$queryRaw<{ saldo_reservado: string }[]>(Prisma.sql`
        SELECT saldo_reservado FROM peca_saldos
         WHERE peca_id = ${item.pecaId}::uuid
           AND deposito_id = ${req.depositoId}::uuid
           FOR UPDATE
      `);
      // Mesma guarda de `executarSeparacao`/`executarEntrega`: `FOR UPDATE`
      // não trava linha que não existe. Sem isto, uma linha ausente em
      // `peca_saldos` deixaria o laço seguir sem trava nenhuma adquirida, e o
      // `UPDATE` abaixo casaria zero linhas em silêncio. Falhar alto é melhor
      // que silenciar.
      if (!linhas[0]) {
        throw new Error(
          `Saldo não encontrado para peça ${item.pecaId} no depósito ${req.depositoId} ` +
            `ao cancelar — estado inconsistente com a reserva.`,
        );
      }

      // As quantidades a devolver vêm de uma leitura feita DEPOIS da trava.
      // Usar `item.quantidadeReservada`/`item.quantidadeSeparada` de
      // `req.itens` (lido antes da transação) seria a SÉTIMA ocorrência do
      // mesmo defeito nesta frente (entrada de estoque, reserva, conferência
      // do kit, duas vezes na entrega, liberação): uma conferência
      // concorrente que mudou o separado faria este UPDATE devolver a
      // quantidade errada — e aqui o erro é para MAIS, criando saldo
      // disponível que não existe na prateleira.
      const fresco = await tx.requisicaoMaterialItem.findUniqueOrThrow({
        where: { id: item.id },
        select: { status: true, quantidadeReservada: true, quantidadeSeparada: true },
      });
      // Oitava ocorrência da mesma classe de defeito nesta frente — agora no
      // STATUS, não na quantidade: uma entrega concorrente pode ter fechado
      // ESTE item enquanto esperávamos a trava. `executarEntrega` (ramo
      // `separado > 0`) NÃO zera `quantidadeReservada`/`quantidadeSeparada`
      // do item que entrega, então os números lidos acima continuariam
      // parecendo devolvíveis — e devolver o que já saiu do depósito cria
      // saldo que não existe na prateleira. Mesmo critério e mesma razão do
      // guard que `executarEntrega` já tem depois da sua trava.
      if (fresco.status === 'entregue' || fresco.status === 'cancelada') continue;

      // Devolve reservado E separado: o que estava na caixa volta à
      // prateleira. Aritmética RELATIVA no banco — nunca "leia, some em JS,
      // grave absoluto" — igual ao resto do arquivo.
      await tx.$executeRaw(Prisma.sql`
        UPDATE peca_saldos
           SET saldo_reservado = saldo_reservado - ${Number(fresco.quantidadeReservada)},
               saldo_separado  = saldo_separado  - ${Number(fresco.quantidadeSeparada)},
               updated_at = now()
         WHERE peca_id = ${item.pecaId}::uuid
           AND deposito_id = ${req.depositoId}::uuid
      `);
    }

    // `notIn: ['entregue', 'cancelada']` continua correto depois da Task 6:
    // aquela mudança fecha itens não separados como `cancelada` só quando a
    // REQUISIÇÃO INTEIRA está sendo entregue (`executarEntrega`), um caminho
    // que este método nunca alcança — aqui a requisição ainda não é
    // `entregue` (checado acima). Itens já `entregue` (entrega parcial de um
    // item não impeditivo, ver achado Critical C2 de `executarEntrega`)
    // ficam de fora de propósito: a peça daquele item já saiu do depósito, e
    // o cancelamento não pode reescrever isso.
    await tx.requisicaoMaterialItem.updateMany({
      where: { requisicaoId: req.id, status: { notIn: ['entregue', 'cancelada'] } },
      data: { status: 'cancelada', quantidadeReservada: 0, quantidadeSeparada: 0 },
    });

    // Achado Critical C1: um `update` incondicional sobrescrevia uma
    // requisição que uma entrega concorrente já tivesse fechado como
    // `entregue` enquanto este cancelamento trabalhava — sem erro nenhum, e
    // depois de o laço acima já ter decrementado o saldo dela. `updateMany`
    // condicionado ao mesmo `notIn` do fechamento dos itens fecha a corrida:
    // quando não casa nenhuma linha, o `throw` abaixo reverte por ROLLBACK os
    // decrementos que já rodaram neste laço. Mesmo padrão do `updateMany`
    // guardado de `executarEntrega`.
    const fechada = await tx.requisicaoMaterial.updateMany({
      where: { id: req.id, status: { notIn: ['entregue', 'cancelada'] } },
      data: {
        status: 'cancelada',
        canceladaEm: new Date(),
        canceladaPorCompanyUserId: input.autorCompanyUserId,
        motivoCancelamento: motivo,
      },
    });
    if (fechada.count === 0) {
      throw new ConflictException(
        'A requisição foi fechada por outra operação enquanto este cancelamento rodava.',
      );
    }

    // A OS volta ao começo: sem materiais reservados, ela não promete nada.
    // Achado minor m6 da revisão: hoje é seguro fixar `'planejada'` porque
    // nenhum outro código deste repo escreve `em_execucao`/`concluida` em
    // `statusMateriais` — no dia em que passar a escrever, cancelar uma
    // requisição vai rebobinar a OS por cima desse estado.
    await this.atualizarStatusMateriaisDaOs(tx, req.serviceOrderId, input.companyId, 'planejada');

    return { statusMateriais: 'planejada' };
  }

  /**
   * A fila do almoxarife. FIFO: quem pediu primeiro espera menos.
   *
   * Sem filtro, `entregue` e `cancelada` ficam de fora — a tela responde "o que
   * eu faço agora", e histórico tem tela própria.
   */
  async listarRequisicoes(companyId: string, status?: string) {
    if (status && !STATUS_REQUISICAO.includes(status as never)) {
      throw new BadRequestException(`Status desconhecido: ${status}`);
    }
    return this.prisma.requisicaoMaterial.findMany({
      where: {
        companyId,
        status: status ? status : { in: [...STATUS_NA_FILA] },
      },
      include: {
        deposito: true,
        serviceOrder: {
          select: { id: true, protocolo: true, equipmentNome: true, equipmentPlaca: true },
        },
        itens: { include: { peca: { select: { codigoInterno: true, unidade: true } } } },
      },
      orderBy: { createdAt: 'asc' },
      take: 200,
    });
  }

  async detalharRequisicao(companyId: string, id: string) {
    const req = await this.prisma.requisicaoMaterial.findFirst({
      where: { id, companyId },
      include: {
        deposito: true,
        serviceOrder: {
          select: { id: true, protocolo: true, equipmentNome: true, equipmentPlaca: true },
        },
        itens: {
          include: {
            peca: {
              select: { id: true, codigoInterno: true, codigoFabricante: true, unidade: true },
            },
          },
        },
      },
    });
    if (!req) throw new NotFoundException('Requisição não encontrada para esta empresa.');
    return req;
  }
}
