import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { normalizarCodigo } from './regras/codigo';
import { Prisma } from '../../prisma/generated/client';
import { disponivel } from './regras/disponibilidade';
import { novoCustoMedio, type TipoMovimento } from './regras/movimento';
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
import {
  MAX_TENTATIVAS_CONCORRENCIA,
  colisaoDeRequisicaoJaAberta,
  comRetryDeContencao,
  compararPorPeca,
  erroDeContencaoTransitoria,
  travarRequisicao,
} from './transacao';
import {
  enviarNotificacoes,
  montarNotificacaoKitCompleto,
  montarNotificacaoOsLiberada,
  usuariosDoAlmoxarifado,
  type NotificacaoPronta,
} from './notificacoes/almoxarifado-notificacoes';

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

/**
 * Os cinco tipos do razão — espelho EM TEMPO DE EXECUÇÃO de `TipoMovimento`
 * (`regras/movimento.ts`). Duplicado de propósito: um `type` union some no
 * JS compilado, então a validação de `?tipo=` precisa de uma lista de
 * verdade, não só do type-check.
 */
const TIPOS_MOVIMENTO: readonly TipoMovimento[] = [
  'entrada',
  'saida',
  'ajuste',
  'devolucao',
  'transferencia',
];

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
      .sort((a, b) => compararPorPeca(a.item.pecaId, b.item.pecaId));

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
      include: {
        itens: true,
        // Task 8: `notificarKitCompleto` cita o protocolo da OS na mensagem,
        // quando o kit fecha. Carregar aqui evita uma segunda ida ao banco
        // dentro da transação — mesmo raciocínio de `liberarRequisicao`.
        serviceOrder: { select: { protocolo: true } },
      },
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
        const resultado = await this.prisma.$transaction((tx) =>
          this.executarSeparacao(tx, input, req, planejado, req.serviceOrder.protocolo),
        );
        // Achados Important I3/I4 da rodada 2: a notificação sai DEPOIS do
        // laço de retry ter sucesso — nunca dentro dele (uma tentativa que
        // aciona retry não pode notificar, e uma tentativa bem-sucedida não
        // pode notificar duas vezes) — e DEPOIS do commit, com o client
        // normal (`this.prisma`), nunca com `tx`. `resultado.notificacoes`
        // só tem linhas quando ESTA chamada de fato fechou o kit (a releitura
        // fresca dentro de `executarSeparacao` decide isso via `updateMany` +
        // `count`); `enviarNotificacoes` nunca lança, então uma falha aqui
        // não pode virar 500 de um kit que já fechou de verdade.
        await enviarNotificacoes(this.prisma, resultado.notificacoes);
        // A resposta pública não pode ganhar o campo `notificacoes` — só o
        // controller consome este retorno.
        return { statusRequisicao: resultado.statusRequisicao, statusMateriais: resultado.statusMateriais };
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
    // Task 8: protocolo da OS, para a mensagem de `montarNotificacaoKitCompleto`.
    // Passado à parte (em vez de lido de `req.serviceOrder`) porque
    // `RequisicaoComItens` só inclui `itens` — alargar o type alcançaria
    // `executarEntrega`/`executarCancelamento`, que reaproveitam o mesmo
    // type e não carregam `serviceOrder`.
    protocolo: string,
  ): Promise<{
    statusRequisicao: string;
    statusMateriais: StatusMateriais;
    // Achados I3/I4 da rodada 2: linhas já MONTADAS (nunca gravadas aqui
    // dentro) — vazio quando esta chamada não fechou o kit. Quem chama
    // (`separarItens`) grava depois do commit, fora do laço de retry.
    notificacoes: NotificacaoPronta[];
  }> {
    // Fundação da F4: trava a REQUISIÇÃO antes de qualquer outra coisa e
    // relê o status dela. Sem isto, uma entrega que fechasse a requisição
    // enquanto esta conferência esperava a trava de `peca_saldos` era
    // reescrita para `em_separacao` pelo `update` incondicional lá embaixo — a
    // corrida que ficou aberta como tarefa própria na F3.
    await travarRequisicao(tx, req.id, input.companyId);
    const reqFresca = await tx.requisicaoMaterial.findUniqueOrThrow({
      where: { id: req.id },
      select: { status: true },
    });
    if (reqFresca.status === 'entregue' || reqFresca.status === 'cancelada') {
      throw new ConflictException(`Requisição ${reqFresca.status} não aceita conferência.`);
    }

    // A validação de `separarItens` usou o retrato de fora da transação.
    // Refeita aqui contra os itens relidos com a requisição travada: a reserva
    // de um item pode ter mudado entre as duas leituras (na F4 o recebimento
    // de compra SOBE a reserva de um item faltante), e conferir contra o
    // número velho gravaria `quantidadeSeparada` acima da reserva real — o
    // CHECK `req_item_cascata_quantidades` derrubaria, mas com 500 em vez de
    // mensagem.
    const itensDaRequisicao = await tx.requisicaoMaterialItem.findMany({
      where: { requisicaoId: req.id },
    });
    const frescoPorId = new Map(itensDaRequisicao.map((i) => [i.id, i]));
    for (const p of planejado) {
      const fresco = frescoPorId.get(p.item.id);
      if (!fresco) {
        throw new BadRequestException(`Item ${p.item.id} não é desta requisição.`);
      }
      const v = validarConferencia(
        {
          quantidadeReservada: Number(fresco.quantidadeReservada),
          status: fresco.status,
          impeditivo: fresco.impeditivo,
          divergencia: fresco.divergencia,
        },
        { quantidade: p.quantidade },
      );
      if (!v.ok) throw new BadRequestException(v.erro);
    }

    // Achado Important I1 da reserva, válido aqui pela mesma razão: trava
    // `peca_saldos` SEMPRE na mesma ordem — por `pecaId` — entre chamadas
    // concorrentes. Duas conferências simultâneas travando as mesmas linhas
    // em ordens opostas dão deadlock (`40P01`), que não é `P2002`.
    const ordemDeTrava = [...planejado].sort((a, b) => compararPorPeca(a.item.pecaId, b.item.pecaId));

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
      // Achado Important M1, com a premissa corrigida pela revisão final
      // (achado I6 — a classe de defeito que já custou dois Criticals
      // nesta frente): `FOR UPDATE` não trava linha que não existe — sem
      // linha, `linhas[0]` vem vazio. A versão anterior deste comentário
      // dizia que isso "deveria ser impossível" porque um item só chegaria
      // a `status: 'reservada'` quando `saldo_reservado > 0` tivesse sido
      // gravado — PREMISSA FALSA: uma linha de plano cuja quantidade
      // resolvesse a zero (`parseQuantidade`, antes do achado I6) produzia
      // `reservar = 0` e `faltante = 0`, ou seja `status: 'reservada'` SEM
      // nenhum `UPDATE` em `peca_saldos` — e se a peça nunca tivesse
      // entrada no depósito, exatamente este `throw` disparava como 500
      // cru. O achado I6 fechou aquele caminho (quantidade nunca mais
      // resolve a zero), mas a guarda continua aqui de propósito: falhar
      // alto é melhor que silenciar, e não vale supor "impossível" de novo
      // — tratar a ausência como zero deixaria o `UPDATE` abaixo casar zero
      // linhas (sem erro nenhum — o CHECK só vale para linha que É escrita)
      // enquanto o item já teria sido marcado como separado, um estado
      // inconsistente sem alerta.
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
          // Achado minor m1 da revisão final da F3: a reserva e o impeditivo
          // que decidem o status do item são os FRESCOS (`itemFresco`, relido
          // depois das travas) — nunca os do retrato de fora da transação.
          status: statusDoItemAposSeparacao(
            {
              quantidadeReservada: Number(itemFresco.quantidadeReservada),
              status: itemFresco.status,
              impeditivo: itemFresco.impeditivo,
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

    // Achado Critical N1 da rodada 3: a guarda `status: { not: 'separada' }`
    // NÃO PODE ser a ÚNICA escrita da requisição. Ela funde duas
    // responsabilidades — detectar a transição de FECHAMENTO (que tem de
    // ser atômica, para não notificar duas vezes — achado I3) e gravar o
    // status calculado, seja ele qual for. Pendurada sozinha, uma
    // reconferência que REBAIXA o status (confere menos, ou informa
    // divergência num kit já `separada`) casava zero linhas: o banco ficava
    // em `separada` obsoleto enquanto a resposta devolvia `em_separacao`, e
    // o único portão de `liberarRequisicao` (`req.status !== 'separada'`)
    // liberava um kit incompleto. Por isso: a guarda só entra quando o
    // status CALCULADO é `separada`; qualquer outra transição — inclusive a
    // REVERSA — é gravada sempre, sem condição nenhuma.
    let fechouAgora = false;
    if (statusRequisicao === 'separada') {
      const fechamento = await tx.requisicaoMaterial.updateMany({
        where: { id: req.id, status: { not: 'separada' } },
        data: {
          status: statusRequisicao,
          atendidaPorCompanyUserId: input.autorCompanyUserId,
          atendidaEm: new Date(),
        },
      });
      fechouAgora = fechamento.count === 1;
      if (!fechouAgora) {
        // Já estava `separada` (reconferência redundante): o status não
        // muda, mas achado Important M2 continua valendo — "quem mexeu por
        // último" é regravado mesmo sem fechar nada de novo.
        await tx.requisicaoMaterial.update({
          where: { id: req.id },
          data: {
            atendidaPorCompanyUserId: input.autorCompanyUserId,
            atendidaEm: new Date(),
          },
        });
      }
    } else {
      // Inclui a transição REVERSA (separada → em_separacao) — incondicional
      // de propósito. A corrida com uma entrega ou um cancelamento fechando a
      // requisição ao mesmo tempo está fechada no começo desta transação
      // (trava da requisição + status relido; terminal é recusado). A guarda
      // do outro ramo existe só para a notificação sair uma vez.
      await tx.requisicaoMaterial.update({
        where: { id: req.id },
        data: {
          status: statusRequisicao,
          atendidaPorCompanyUserId: input.autorCompanyUserId,
          atendidaEm: new Date(),
        },
      });
    }

    // Achado Important I1 (deste review — nome repetido, achado diferente
    // do I1 da reserva citado acima): o override de divergência só pode
    // valer quando `statusAposSeparacao` JÁ fecharia o kit. Sem o `base ===
    // 'materiais_separados'`, uma OS com item FALTANTE mais uma divergência
    // qualquer reportaria `aguardando_separacao` em vez de
    // `aguardando_compra`, e o fluxo de compra nunca seria acionado.
    const base = statusAposSeparacao(paraRegra.map((i) => ({ impeditivo: i.impeditivo, status: i.status })));
    const statusMateriais = temDivergencia(paraRegra) && base === 'materiais_separados' ? 'aguardando_separacao' : base;

    await this.atualizarStatusMateriaisDaOs(tx, req.serviceOrderId, input.companyId, statusMateriais);

    // Kit fechou NESTA chamada (`fechouAgora`, a transição atômica acima —
    // não só `statusRequisicao === 'separada'`, que também é verdade numa
    // reconferência redundante): MONTA as linhas de notificação (resolve
    // destinatários, ainda dentro da transação). Não GRAVA nada aqui — quem
    // chama (`separarItens`) grava depois do commit, com `enviarNotificacoes`.
    let notificacoes: NotificacaoPronta[] = [];
    if (fechouAgora) {
      const destinatarios = await usuariosDoAlmoxarifado(tx, input.companyId);
      notificacoes = await montarNotificacaoKitCompleto(tx, {
        companyId: input.companyId,
        requisicaoId: req.id,
        numero: req.numero,
        protocolo,
        destinatarios,
      });
    }

    return { statusRequisicao, statusMateriais, notificacoes };
  }

  /**
   * O almoxarife diz que o kit está pronto e a OS pode andar.
   *
   * Ato EXPLÍCITO, e não consequência automática da conferência: separar é
   * trabalho de prateleira, liberar é a pessoa assumindo que o kit confere. O
   * spec funcional separa os dois passos (7 e 8) pela mesma razão.
   *
   * Não mexe em `peca_saldos` nem no razão do estoque. Trava a requisição
   * (fundação da F4) e por isso usa o mesmo laço de retry por contenção dos
   * outros métodos. Achado minor m4 da revisão final da F3: o comentário
   * antigo dizia que, sem `FOR UPDATE`, não havia contenção a tratar — mas
   * `P2034` também chega em escrita não-raw.
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

    const resultado = await comRetryDeContencao('a liberação', () =>
      this.prisma.$transaction(async (tx) => {
        // Fundação da F4: trava a requisição e relê o status antes de decidir
        // qualquer coisa. O portão de fora (`req.status !== 'separada'`) olhou
        // um retrato — uma reconferência que rebaixou o kit pode ter commitado
        // depois dele, e liberar por aquele retrato mandaria o mecânico buscar
        // um kit incompleto.
        await travarRequisicao(tx, req.id, input.companyId);
        const reqFresca = await tx.requisicaoMaterial.findUniqueOrThrow({
          where: { id: req.id },
          select: { status: true },
        });
        if (reqFresca.status !== 'separada') {
          throw new ConflictException(
            `Só requisição com kit conferido é liberada — esta está "${reqFresca.status}".`,
          );
        }

        // Achado Important I3 da rodada 2: guarda `liberadaEm: null` — sem
        // ela, uma segunda chamada (o guard de fora só olha `status ===
        // 'separada'`, que a liberação NÃO muda) re-estamparia `liberadaEm`/
        // `liberadaPorCompanyUserId` e avisaria mecânico e programador de
        // novo, para o MESMO evento. `count === 1` só é verdade quando ESTA
        // chamada de fato liberou a requisição pela primeira vez.
        const fechamento = await tx.requisicaoMaterial.updateMany({
          where: { id: req.id, liberadaEm: null },
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
        // errado manda buscar um kit que não está pronto. Roda mesmo numa
        // chamada repetida: recalcular o `statusMateriais` da OS é idempotente
        // e barato, só a NOTIFICAÇÃO precisa do guard acima.
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

        // OS liberada PELA PRIMEIRA VEZ nesta chamada (`fechamento.count ===
        // 1`) E o status CALCULADO acima é `liberada_para_execucao` — achado
        // Important I1 da revisão final. Antes, a segunda condição não
        // existia: bastava `fechamento.count === 1` para montar "OS liberada,
        // retire o kit" mesmo quando `statusMateriais` saía `aguardando_compra`
        // (item não impeditivo faltante, requisição fechada só pelos
        // impeditivos). O mecânico recebia o aviso de retirada na mesma hora
        // em que a própria bancada mostrava a OS em vermelho, "Aguardando
        // peça", para o mesmo protocolo. MONTA as linhas de notificação
        // (resolve mecânico e programador, ainda dentro da transação — dados
        // já carregados acima em `req.serviceOrder.*`/`req.deposito.nome`).
        // Não GRAVA nada aqui — quem chama grava depois do commit, com
        // `enviarNotificacoes`.
        let notificacoes: NotificacaoPronta[] = [];
        if (fechamento.count === 1 && statusMateriais === 'liberada_para_execucao') {
          notificacoes = await montarNotificacaoOsLiberada(tx, {
            companyId: input.companyId,
            serviceOrderId: req.serviceOrderId,
            protocolo: req.serviceOrder.protocolo,
            equipmentNome: req.serviceOrder.equipmentNome,
            equipmentId: req.serviceOrder.equipmentId,
            responsavelOperatorId: req.serviceOrder.responsavelOperatorId,
            local: req.deposito.nome,
          });
        }

        return { statusMateriais, notificacoes };
      }),
    );

    // Achados I3/I4 da rodada 2: a notificação sai DEPOIS do commit, com o
    // client normal — nunca com `tx`. `enviarNotificacoes` nunca lança.
    await enviarNotificacoes(this.prisma, resultado.notificacoes);
    // A resposta pública não pode ganhar o campo `notificacoes`.
    return { statusMateriais: resultado.statusMateriais };
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

    // Retrato de fora da transação: serve só para devolver 404/409 cedo, sem
    // abrir transação à toa. Quem DECIDE é a releitura com a requisição
    // travada, dentro de `executarEntrega`.
    const req = await this.prisma.requisicaoMaterial.findFirst({
      where: { id: input.requisicaoId, companyId: input.companyId },
      select: { id: true, status: true, serviceOrderId: true, depositoId: true },
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

    // Achado Important I3 da revisão final da F3: quem retira o kit tem de
    // ser funcionário DESTA empresa. A FK `recebedor_operator_id` é global e o
    // seletor da tela era o único controle — uma chamada forjada registrava
    // operador de outra empresa como quem levou a peça, num ato que não se
    // desfaz. Mesmo molde de `validarDeposito`.
    const recebedor = await this.prisma.operator.findFirst({
      where: { id: input.recebedorOperatorId, companyId: input.companyId },
      select: { id: true },
    });
    if (!recebedor) {
      throw new NotFoundException('Funcionário que retira o kit não encontrado nesta empresa.');
    }

    // Mesma rede de contenção da reserva e da separação
    // (`erroDeContencaoTransitoria`): sem isto, um `40001`/`P2034` na trava
    // de `peca_saldos` chegaria ao cliente como 500 cru.
    for (let tentativa = 1; tentativa <= MAX_TENTATIVAS_CONCORRENCIA; tentativa++) {
      try {
        return await this.prisma.$transaction((tx) => this.executarEntrega(tx, input, req));
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
    req: Pick<RequisicaoComItens, 'id' | 'serviceOrderId' | 'depositoId'>,
  ): Promise<{ statusMateriais: StatusMateriais }> {
    // Fundação da F4: trava a REQUISIÇÃO antes de tudo e relê status e
    // liberação com a trava na mão. O portão de fora olhou um retrato: uma
    // reconferência que rebaixou o kit, ou um cancelamento, pode ter commitado
    // depois dele.
    await travarRequisicao(tx, req.id, input.companyId);
    const reqFresca = await tx.requisicaoMaterial.findUniqueOrThrow({
      where: { id: req.id },
      select: { status: true, liberadaEm: true },
    });
    if (reqFresca.status === 'entregue') {
      throw new ConflictException('Esta requisição já foi entregue.');
    }
    if (reqFresca.status !== 'separada') {
      throw new ConflictException(
        `Só requisição com kit conferido é entregue — esta está "${reqFresca.status}".`,
      );
    }
    // Achado Important I2 da revisão final: entregar sem nunca ter passado
    // por `liberarRequisicao` pulava o ato explícito do passo 8 do §6 (e a
    // notificação de §9) — `liberadaEm` ficava NULL para sempre e a OS ainda
    // assim chegava a `liberada_para_execucao`.
    if (!reqFresca.liberadaEm) {
      throw new ConflictException(
        'Esta requisição ainda não foi liberada — libere o kit antes de confirmar a entrega.',
      );
    }

    // O CONJUNTO do que entregar sai da releitura com a requisição travada —
    // não mais de um retrato de fora da transação. Até a F3 o retrato era
    // tolerável porque a reserva de um item "só descia" depois de criada; o
    // recebimento de compra (F4) SOBE a reserva de um item faltante, e um item
    // que entrasse na lista entre o retrato e a trava ficaria de fora da
    // entrega, com a reserva presa numa requisição fechada.
    //
    // Entra todo item com peça vinculada e alguma reserva viva, MENOS:
    // - `entregue`/`cancelada` — já fechados;
    // - `faltante` — fundação da F4: requisição com falta NÃO fecha (achado
    //   I7, decisão do produto), então a reserva parcial desse item (ex.: 3
    //   de 5) continua servindo a esta OS até a compra cobrir o resto.
    //   Devolvê-la aqui fazia a falta saltar de 2 para 5 depois da entrega, e
    //   a solicitação de compra aberta por 2 ficava curta.
    //
    // Item `reservada` não conferido CONTINUA entrando (achado Critical C2):
    // só pode ser não impeditivo — impeditivo não conferido não deixa o kit
    // fechar, e sem kit fechado a requisição não chega a `separada` — e a
    // reserva dele é devolvida abaixo.
    const itensDaRequisicao = await tx.requisicaoMaterialItem.findMany({
      where: { requisicaoId: req.id },
    });
    const candidatos = itensDaRequisicao.filter(
      (i) =>
        i.pecaId &&
        Number(i.quantidadeReservada) > 0 &&
        i.status !== 'faltante' &&
        i.status !== 'entregue' &&
        i.status !== 'cancelada',
    );

    // Mesma ordem única de trava de `peca_saldos` dos outros métodos
    // (`compararPorPeca`): travar sempre na mesma direção entre chamadas
    // concorrentes evita deadlock (`40P01`) em vez de só detectá-lo depois.
    const ordemDeTrava = [...candidatos].sort((a, b) => compararPorPeca(a.pecaId, b.pecaId));

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
        // Inalcançável: `faltante` não entra em `candidatos` (ver acima), e
        // `separada` com nada separado não existe (`statusDoItemAposSeparacao`
        // só estampa `separada` com quantidade > 0). Com a requisição travada,
        // o status relido não muda por baixo. Falhar alto em vez de adivinhar:
        // o `UPDATE` de saldo acima já rodou, e o `throw` é o ROLLBACK dele.
        throw new Error(
          `Item ${item.id} em estado inesperado na entrega (${itemFresco.status}, nada separado).`,
        );
      }
    }

    // Achado Critical C1 (sexta ocorrência nesta frente): relê TODOS os
    // itens da requisição AQUI, dentro da transação — nunca `req.itens`, o
    // retrato de fora dela. Hoje nada grava `faltante` depois da criação do
    // item, mas a Task 7 (compra e recebimento) é candidata óbvia a fazer
    // isso; no dia em que fizer, ler de fora carimbaria
    // `liberada_para_execucao` numa OS com peça faltando, em silêncio. Mesmo
    // critério de `liberarRequisicao` (releitura fresca, quinta ocorrência).
    //
    // Movida para ANTES da decisão de fechar a requisição (achado Important
    // I7 da revisão final): decidir se ela fecha como `entregue` ou continua
    // aberta depende do que sobrou de pendência, então a releitura tem de
    // vir primeiro.
    const itensFrescos = await tx.requisicaoMaterialItem.findMany({
      where: { requisicaoId: req.id },
    });
    const paraRegra = itensFrescos.map((i) => ({ impeditivo: i.impeditivo, status: i.status }));
    const statusMateriais = statusAposEntrega(paraRegra);
    await this.atualizarStatusMateriaisDaOs(tx, req.serviceOrderId, input.companyId, statusMateriais);

    // Achado Important I7 da revisão final — decisão do produto (2026-09-13):
    // "entrega o que tem, e a requisição fica ABERTA". Só fecha como
    // `entregue` quando NADA mais está pendente (`statusMateriais ===
    // 'liberada_para_execucao'`, ou seja nenhum item vivo `faltante`/
    // `nao_vinculado` — os impeditivos já são exigência de `separada`, então
    // o que resta aqui é sempre não impeditivo). Antes desta correção,
    // `entregarRequisicao` fechava a requisição como `entregue` (terminal)
    // mesmo sobrando um item assim: `cancelarRequisicao` passava a recusar
    // ("a peça já saiu"), o índice único parcial
    // `requisicoes_material_uma_aberta_por_os` continuava contando essa
    // linha como a aberta da OS, e sem a fatia de compras (F4) nada mais
    // preenchia a falta — a OS ficava travada em `aguardando_compra` para
    // sempre. Deixando o status como está (`separada`, o único valor
    // possível para chegar aqui — `entregarRequisicao` já exige isso antes
    // de abrir a transação), a requisição continua sendo A requisição
    // aberta da OS, `cancelarRequisicao` continua aceitando (só recusa
    // `entregue`/`cancelada`), e uma futura F4 tem onde escrever quando a
    // peça chegar.
    if (statusMateriais === 'liberada_para_execucao') {
      // Achado Important I1 da revisão: `updateMany` condicionado a
      // `status: 'separada'` fecha a corrida entre duas entregas
      // concorrentes. Sem isto, uma segunda chamada que passasse as duas
      // guardas de fora da transação (ambas leem "separada" antes de
      // qualquer uma commitar) sobrescrevia `entregueEm`/
      // `recebedorOperatorId`/`confirmacaoTipo`/`assinatura` com os dados
      // de quem chegou depois — apagando a prova de quem realmente recebeu
      // o kit, e ainda devolvendo 200 para as duas.
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
    }

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
    // Fundação da F4: trava a requisição ANTES de ler o status dela. Sem a
    // trava, este `findFirst` enxergava o estado de um instante qualquer (READ
    // COMMITTED), e uma entrega concorrente podia fechar a requisição entre a
    // leitura e o fim desta transação. Com a trava, entrega e cancelamento se
    // enfileiram na mesma linha. As guardas pós-trava de saldo abaixo (o
    // `continue` por item já fechado e o `updateMany` condicionado no
    // fechamento) ficam como segunda rede. O motivo, por não depender de
    // estado nenhum do banco, já foi validado antes do laço de retry.
    await travarRequisicao(tx, input.requisicaoId, input.companyId);
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

    // Mesma ordem única de trava de `peca_saldos` dos outros métodos
    // (`compararPorPeca`, em `transacao.ts`).
    const ordemDeTrava = [...aLiberar].sort((a, b) => compararPorPeca(a.pecaId, b.pecaId));

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

  /**
   * O razão do estoque (`estoque_movimentos`) — histórico append-only,
   * somente leitura (o gatilho do banco barra UPDATE/DELETE; esta tela nem
   * tenta). Mais recente primeiro — o oposto da fila do almoxarife
   * (`listarRequisicoes`, FIFO): ali é "o que fazer agora", aqui é
   * auditoria de "o que já aconteceu".
   *
   * `autorCompanyUserId` não tem relação no Prisma — o comentário do schema
   * é explícito ("UUID solto de propósito … o razão precisa sobreviver à
   * remoção do CompanyUser que autorou o movimento"), então não dá para
   * `include` o autor como se fosse FK. Resolvido numa SEGUNDA consulta, com
   * todos os ids distintos da PÁGINA de uma vez (`companyUser.findMany` com
   * `id: { in }`) — não um `findUnique` por linha, que seria o N+1 que a
   * tela pediu para evitar.
   */
  async listarMovimentos(
    companyId: string,
    filtros: {
      pecaId?: string;
      depositoId?: string;
      tipo?: string;
      page?: number;
      pageSize?: number;
    },
  ) {
    if (filtros.tipo && !TIPOS_MOVIMENTO.includes(filtros.tipo as TipoMovimento)) {
      throw new BadRequestException(`Tipo de movimento desconhecido: ${filtros.tipo}`);
    }

    // `Number.isFinite` cobre `NaN` — `?page=abc` (chega como string do
    // controller, convertida com `Number(...)`) não pode virar `skip: NaN`
    // e estourar um erro cru do Prisma.
    const page = Number.isFinite(filtros.page) ? Math.max(0, filtros.page as number) : 0;
    const pageSize = Number.isFinite(filtros.pageSize)
      ? Math.min(200, Math.max(1, filtros.pageSize as number))
      : 50;

    const where: Prisma.EstoqueMovimentoWhereInput = { companyId };
    if (filtros.pecaId) where.pecaId = filtros.pecaId;
    if (filtros.depositoId) where.depositoId = filtros.depositoId;
    if (filtros.tipo) where.tipo = filtros.tipo;

    const [total, movimentos] = await Promise.all([
      this.prisma.estoqueMovimento.count({ where }),
      this.prisma.estoqueMovimento.findMany({
        where,
        include: {
          peca: { select: { codigoInterno: true, descricao: true } },
          deposito: { select: { nome: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: page * pageSize,
        take: pageSize,
      }),
    ]);

    // Ids distintos, numa consulta só — não uma por linha da página.
    const autorIds = [...new Set(movimentos.map((m) => m.autorCompanyUserId))];
    const autores = autorIds.length
      ? await this.prisma.companyUser.findMany({
          where: { id: { in: autorIds } },
          select: { id: true, name: true },
        })
      : [];
    const nomePorAutorId = new Map(autores.map((a) => [a.id, a.name]));

    const rows = movimentos.map((m) => ({
      id: m.id,
      tipo: m.tipo,
      // COM SINAL — mesmo contrato de `estoque_movimentos.quantidade`
      // (saída negativa). Decimal do Prisma atravessa o JSON como string;
      // quem lê (o painel) converte, como já faz com os outros Decimal.
      quantidade: m.quantidade,
      saldoApos: m.saldoApos,
      custoUnit: m.custoUnit,
      origemTipo: m.origemTipo,
      origemId: m.origemId,
      observacao: m.observacao,
      createdAt: m.createdAt,
      peca: { codigoInterno: m.peca.codigoInterno, descricao: m.peca.descricao },
      deposito: { nome: m.deposito.nome },
      // Achado defensivo (sem repro real): `autorCompanyUserId` não tem FK —
      // se o CompanyUser algum dia for removido, o razão não pode quebrar a
      // tela por causa de um nome que sumiu.
      autorNome: nomePorAutorId.get(m.autorCompanyUserId) ?? 'Usuário removido',
    }));

    return { rows, total, page, pageSize };
  }
}
