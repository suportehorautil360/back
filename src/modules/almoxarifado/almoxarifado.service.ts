import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { normalizarCodigo } from './regras/codigo';
import { Prisma } from '../../prisma/generated/client';
import { disponivel } from './regras/disponibilidade';
import { novoCustoMedio } from './regras/movimento';
import { statusAposConsulta, type StatusMateriais } from './regras/status-materiais';
import { itensDeTrocaDoCiclo, resolverPeca, type ItemDeTroca } from './regras/plano-pecas';
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
 * Verdadeiro para os erros de CONTENÇÃO que vale a pena tentar de novo com a
 * transação inteira do zero:
 *
 * - `P2002`: colisão no número da requisição (duas transações calculando o
 *   mesmo MAX+1 ao mesmo tempo).
 * - `P2010` com `meta.code` `40P01` (deadlock) ou `40001` (falha de
 *   serialização) — os dois só existem em erro de `$queryRaw`/`$executeRaw`
 *   (as raw queries do `SELECT … FOR UPDATE`): é assim que o Prisma expõe o
 *   SQLSTATE cru do Postgres quando uma raw query falha. Achado Important
 *   I1: o laço de travas ordenado por `pecaId` (ver `executarReserva`) evita
 *   a maior parte dos deadlocks ENTRE duas chamadas deste método, mas não
 *   os elimina por completo (pooler de conexão, outra rota tocando a mesma
 *   linha), então o retry continua sendo a rede de segurança.
 */
function erroDeContencaoTransitoria(erro: unknown): boolean {
  if (!(erro instanceof Prisma.PrismaClientKnownRequestError)) return false;
  if (erro.code === 'P2002') return true;
  if (erro.code === 'P2010') {
    const sqlstate = (erro.meta as { code?: string } | undefined)?.code;
    return sqlstate === '40P01' || sqlstate === '40001';
  }
  return false;
}

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
    const brutos = itensDeTrocaDoCiclo(
      plano?.categorias, input.categoriaPlanoId, input.cicloId,
    );
    if (brutos.length === 0) return [];

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
}
