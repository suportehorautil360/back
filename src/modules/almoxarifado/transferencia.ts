import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '../../prisma/generated/client';
import { registrarAuditoriaSuprimentos } from './auditoria';
import {
  formatNumeroTransferencia,
  parseNumeroTransferenciaSeq,
} from './helpers/numero-transferencia.helper';
import { novoCustoMedio } from './regras/movimento';
import { cabeNoDisponivel, statusAposRecebimento, temDivergencia } from './regras/transferencia';
import { compararPorPecaEDeposito } from './transacao';

type ClienteDaTransacao = Prisma.TransactionClient;

export interface EntradaDeCriacao {
  companyId: string;
  depositoOrigemId: string;
  depositoDestinoId: string;
  itens: Array<{ pecaId: string; quantidade: number }>;
  autorCompanyUserId: string;
  observacao?: string | null;
}

/**
 * Monta a transferência como RASCUNHO: nada sai de lugar nenhum ainda. O saldo
 * só se mexe na expedição, e é isso que permite montar a lista com calma e
 * conferir antes de despachar.
 */
export async function criarTransferencia(
  tx: ClienteDaTransacao,
  input: EntradaDeCriacao,
): Promise<{ id: string; numero: string; itens: number }> {
  if (input.depositoOrigemId === input.depositoDestinoId) {
    throw new BadRequestException('Origem e destino têm de ser depósitos diferentes.');
  }
  if (input.itens.length === 0) {
    throw new BadRequestException('Informe ao menos uma peça para transferir.');
  }
  const vistas = new Set<string>();
  for (const item of input.itens) {
    if (vistas.has(item.pecaId)) {
      throw new BadRequestException('Peça repetida na mesma transferência — some as quantidades numa linha só.');
    }
    vistas.add(item.pecaId);
    // `!(x > 0)` e não `x <= 0`: NaN falha em qualquer comparação e passaria.
    // `Number.isFinite` primeiro: sem ele, `Infinity` passava — `Math.round(
    // Infinity * 1000) > 0` também é `true`. Mesma postura das Tasks 3 e 4:
    // o ato se sustenta sozinho, não conta com o DTO para barrar valor sujo.
    if (!Number.isFinite(item.quantidade) || !(Math.round(item.quantidade * 1000) > 0)) {
      throw new BadRequestException('Quantidade tem de ser maior que zero.');
    }
  }

  const depositos = await tx.deposito.findMany({
    where: { id: { in: [input.depositoOrigemId, input.depositoDestinoId] }, companyId: input.companyId },
    select: { id: true, ativo: true },
  });
  if (depositos.length !== 2) {
    throw new NotFoundException('Depósito de origem ou de destino não encontrado nesta empresa.');
  }
  // Só o DESTINO precisa estar ativo — a assimetria é de propósito, não
  // esquecimento. Pôr mercadoria num depósito que a empresa fechou é criar
  // estoque num lugar que ninguém mais olha, então o destino filtra. Mas a
  // ORIGEM pode estar inativa: transferir é o caminho para ESVAZIAR um
  // depósito desativado, e se a origem também exigisse `ativo`, o estoque de
  // um depósito fechado ficaria preso sem saída nenhuma — a mesma armadilha
  // do inventário que não podia ser cancelado (`abrirInventario`/
  // `cancelarInventario`). Não "conserte" essa assimetria sem reler este
  // comentário.
  const destino = depositos.find((d) => d.id === input.depositoDestinoId);
  if (!destino?.ativo) {
    throw new BadRequestException('Depósito de destino está inativo — escolha um depósito ativo.');
  }

  const pecaIds = [...vistas];
  const pecas = await tx.peca.findMany({
    where: { id: { in: pecaIds }, companyId: input.companyId, ativo: true },
    select: { id: true },
  });
  if (pecas.length !== pecaIds.length) {
    throw new BadRequestException('Alguma peça da lista não existe nesta empresa ou está inativa.');
  }

  const ano = new Date().getUTCFullYear();
  const existentes = await tx.transferencia.findMany({
    where: { companyId: input.companyId, numero: { startsWith: `TRF-${ano}-` } },
    select: { numero: true },
  });
  let maxSeq = 0;
  for (const { numero } of existentes) {
    const seq = parseNumeroTransferenciaSeq(numero, ano);
    if (seq !== null && seq > maxSeq) maxSeq = seq;
  }
  const numero = formatNumeroTransferencia(ano, maxSeq + 1);

  const transferencia = await tx.transferencia.create({
    data: {
      companyId: input.companyId,
      numero,
      status: 'rascunho',
      depositoOrigemId: input.depositoOrigemId,
      depositoDestinoId: input.depositoDestinoId,
      criadaPorCompanyUserId: input.autorCompanyUserId,
      observacao: input.observacao ?? null,
    },
    select: { id: true, numero: true },
  });

  await tx.transferenciaItem.createMany({
    data: input.itens.map((i) => ({
      transferenciaId: transferencia.id,
      pecaId: i.pecaId,
      quantidade: i.quantidade,
    })),
  });

  await registrarAuditoriaSuprimentos(tx, {
    companyId: input.companyId,
    acao: 'transferencia.criar',
    alvoTipo: 'suprimentos.transferencia',
    alvoId: transferencia.id,
    atorCompanyUserId: input.autorCompanyUserId,
    motivo: input.observacao ?? null,
    depois: {
      numero,
      depositoOrigemId: input.depositoOrigemId,
      depositoDestinoId: input.depositoDestinoId,
      itens: input.itens.length,
    },
  });

  return { id: transferencia.id, numero: transferencia.numero, itens: input.itens.length };
}

export interface EntradaDeCancelamentoDeTransferencia {
  companyId: string;
  transferenciaId: string;
  autorCompanyUserId: string;
  motivo: string;
}

/**
 * Desiste do RASCUNHO. Só dele: cancelar o que já foi expedido seria inventar
 * uma volta que ninguém dirigiu. Carga perdida se resolve confirmando o
 * recebimento com quantidade zero — aí o razão conta a verdade (saiu 10,
 * entrou 0) em vez de fingir que nada aconteceu.
 *
 * Trava o cabeçalho (posição da ORDEM ÚNICA DE TRAVA reservada a inventário
 * ou transferência, topo de `transacao.ts`) ANTES de ler o status. Sem ela,
 * um cancelamento e uma expedição concorrentes (Task 6) sobre o MESMO
 * rascunho leem "rascunho" os dois, passam na checagem os dois, e escrevem
 * os dois — se a expedição comitar por último, a peça sai da origem sob um
 * documento que o razão diz "cancelado": não está na origem, não está no
 * destino, e não há transferência aberta para alguém ir atrás dela.
 */
export async function cancelarTransferencia(
  tx: ClienteDaTransacao,
  input: EntradaDeCancelamentoDeTransferencia,
): Promise<{ transferenciaId: string; numero: string }> {
  const motivo = (input.motivo ?? '').trim();
  if (!motivo) {
    throw new BadRequestException('Cancelar transferência exige motivo.');
  }

  // Mesma trava do cancelamento de inventário, e na posição que a ORDEM ÚNICA
  // DE TRAVA (topo de `transacao.ts`) reserva ao cabeçalho de transferência.
  // Sem ela, cancelar e expedir correm juntos: os dois leem "rascunho", os
  // dois escrevem, e se a expedição commitar por último a peça sai da origem
  // sob um documento cancelado — some do razão sem ninguém para procurá-la.
  await tx.$queryRaw(Prisma.sql`
    SELECT id FROM transferencias
     WHERE id = ${input.transferenciaId}::uuid
       AND company_id = ${input.companyId}::uuid
       FOR UPDATE
  `);

  const transferencia = await tx.transferencia.findFirst({
    where: { id: input.transferenciaId, companyId: input.companyId },
    select: { id: true, numero: true, status: true },
  });
  if (!transferencia) {
    throw new NotFoundException('Transferência não encontrada nesta empresa.');
  }
  if (transferencia.status !== 'rascunho') {
    throw new ConflictException(
      `Transferência ${transferencia.status} não pode ser cancelada. Se a carga se perdeu, confirme o recebimento com quantidade zero.`,
    );
  }

  await tx.transferencia.update({
    where: { id: transferencia.id },
    data: {
      status: 'cancelada',
      canceladaEm: new Date(),
      canceladaPorCompanyUserId: input.autorCompanyUserId,
      motivoCancelamento: motivo,
    },
  });

  await registrarAuditoriaSuprimentos(tx, {
    companyId: input.companyId,
    acao: 'transferencia.cancelar',
    alvoTipo: 'suprimentos.transferencia',
    alvoId: transferencia.id,
    atorCompanyUserId: input.autorCompanyUserId,
    motivo,
    antes: { numero: transferencia.numero, status: 'rascunho' },
    depois: { numero: transferencia.numero, status: 'cancelada' },
  });

  return { transferenciaId: transferencia.id, numero: transferencia.numero };
}

export interface EntradaDeExpedicao {
  companyId: string;
  transferenciaId: string;
  autorCompanyUserId: string;
}

/**
 * Despacha: a quantidade sai do físico da origem e NÃO entra em lugar nenhum.
 * Entre aqui e a confirmação, ela não está em `peca_saldos` nenhum — é a
 * verdade física, a peça está no caminhão (§5.3, §5.4).
 *
 * O custo da origem é congelado no item: a média de lá pode mudar entre a
 * expedição e a chegada, e o que entra no destino é o valor que saiu.
 *
 * Trava o cabeçalho ANTES de ler o status — mesma forma e mesma posição de
 * `cancelarTransferencia`. Sem ela, um cancelamento e uma expedição
 * concorrentes sobre o MESMO rascunho leem "rascunho" os dois, escrevem os
 * dois, e se a expedição comitar por último a peça sai da origem sob um
 * documento cancelado.
 *
 * Ordem de trava: cabeçalho da transferência, depois `peca_saldos` por
 * `compararPorPecaEDeposito`. Dito com precisão, para não prometer mais do que
 * entrega: AQUI, sozinho, o desempate por depósito da função é código morto —
 * todo item desta chamada tem o MESMO `depositoOrigemId` (só se trava a
 * origem), e dois itens da MESMA transferência nunca têm o mesmo `pecaId`
 * (`@@unique([transferenciaId, pecaId])` no schema), então `compararPorPeca`
 * sozinho já decide toda a ordem antes do desempate ser sequer avaliado. Uso o
 * comparador composto mesmo assim só para ficar IGUAL ao do recebimento (que
 * trava o destino) — não porque a parte composta compre garantia alguma
 * dentro desta função. É a mesma função em ambas as pontas que evita que um
 * dia elas divirjam, não o desempate em si.
 *
 * A origem pode estar INATIVA — de propósito (ver `criarTransferencia`): não
 * acrescente checagem de `ativo` aqui.
 */
export async function expedirTransferencia(
  tx: ClienteDaTransacao,
  input: EntradaDeExpedicao,
): Promise<{ transferenciaId: string; numero: string; itens: number }> {
  // Mesma trava de `cancelarTransferencia`, na mesma posição (ORDEM ÚNICA DE
  // TRAVA, topo de `transacao.ts`): sem ela a corrida com o cancelamento volta.
  await tx.$queryRaw(Prisma.sql`
    SELECT id FROM transferencias
     WHERE id = ${input.transferenciaId}::uuid
       AND company_id = ${input.companyId}::uuid
       FOR UPDATE
  `);

  const transferencia = await tx.transferencia.findFirst({
    where: { id: input.transferenciaId, companyId: input.companyId },
    select: { id: true, numero: true, status: true, depositoOrigemId: true },
  });
  if (!transferencia) {
    throw new NotFoundException('Transferência não encontrada nesta empresa.');
  }
  if (transferencia.status !== 'rascunho') {
    throw new ConflictException(`Transferência ${transferencia.status} não pode ser expedida.`);
  }

  const itens = await tx.transferenciaItem.findMany({
    where: { transferenciaId: transferencia.id },
    select: { id: true, pecaId: true, quantidade: true, peca: { select: { codigoInterno: true } } },
  });
  if (itens.length === 0) {
    throw new BadRequestException('Transferência sem item nenhum não tem o que expedir.');
  }

  const ordenados = [...itens].sort((a, b) =>
    compararPorPecaEDeposito(
      { pecaId: a.pecaId, depositoId: transferencia.depositoOrigemId },
      { pecaId: b.pecaId, depositoId: transferencia.depositoOrigemId },
    ),
  );

  for (const item of ordenados) {
    await tx.$queryRaw(Prisma.sql`
      SELECT peca_id FROM peca_saldos
       WHERE peca_id = ${item.pecaId}::uuid
         AND deposito_id = ${transferencia.depositoOrigemId}::uuid
         FOR UPDATE
    `);

    // A leitura vem DEPOIS da trava, e não é um detalhe: a escrita abaixo
    // (`data: { saldoFisico: depois }`) é um valor ABSOLUTO, não um
    // `decrement`. Sem a linha já travada aqui, duas expedições concorrentes
    // da MESMA peça leem o mesmo `saldoFisico` as duas, as duas passam em
    // `cabeNoDisponivel` contra o mesmo valor, e a que grava por último
    // sobrescreve com um absoluto calculado sobre um saldo que já não é mais
    // verdade — *lost update* clássico, e o CHECK do banco não pega porque o
    // resultado gravado continua ≥ 0.
    const saldo = await tx.pecaSaldo.findUnique({
      where: { pecaId_depositoId: { pecaId: item.pecaId, depositoId: transferencia.depositoOrigemId } },
      select: { saldoFisico: true, saldoReservado: true, custoMedio: true },
    });
    // Sem `upsert`: expedir NUNCA cria linha de saldo — só uma entrada
    // anterior (compra, ajuste, contagem) cria a linha na origem.
    // `criarTransferencia` só garante que a peça existe e está ativa na
    // EMPRESA, nunca que ela tem saldo no depósito de ORIGEM — uma peça
    // cadastrada mas nunca recebida ali chega aqui sem linha nenhuma. Recusa
    // de domínio, nomeando a peça, em vez de deixar um `findUniqueOrThrow`
    // estourar P2025 cru como 500 na cara do almoxarife.
    if (!saldo) {
      throw new NotFoundException(
        `A peça ${item.peca.codigoInterno} não tem saldo no depósito de origem.`,
      );
    }
    const quantidade = Number(item.quantidade);
    const atual = {
      saldoFisico: Number(saldo.saldoFisico),
      saldoReservado: Number(saldo.saldoReservado),
    };
    if (!cabeNoDisponivel(atual, quantidade)) {
      throw new ConflictException(
        `A peça ${item.peca.codigoInterno} não tem esse tanto livre na origem — o que está reservado fica com a OS que o reservou.`,
      );
    }

    const depois = Math.round((atual.saldoFisico - quantidade) * 1000) / 1000;
    // A média da origem NÃO muda: saiu quantidade, não saiu valor unitário.
    await tx.pecaSaldo.update({
      where: { pecaId_depositoId: { pecaId: item.pecaId, depositoId: transferencia.depositoOrigemId } },
      data: { saldoFisico: depois },
    });

    await tx.estoqueMovimento.create({
      data: {
        companyId: input.companyId,
        pecaId: item.pecaId,
        depositoId: transferencia.depositoOrigemId,
        tipo: 'transferencia',
        quantidade: -quantidade,
        saldoApos: depois,
        custoUnit: saldo.custoMedio,
        origemTipo: 'transferencia',
        origemId: transferencia.id,
        autorCompanyUserId: input.autorCompanyUserId,
        observacao: transferencia.numero,
      },
    });

    // Congela o custo da origem FIELMENTE — zero inclusive. `custoMedio` é
    // `NOT NULL DEFAULT 0`: uma peça que só entrou por contagem de inventário
    // ou por entrada sem custo chega aqui com média zero DE VERDADE, não
    // "custo desconhecido". Não vire esse zero em nulo: `custoUnit` nulo no
    // item já significa outra coisa ("ainda não expedido"), e achatar os dois
    // destruiria essa distinção. A regra do que fazer com um zero congelado
    // mora no RECEBIMENTO (Task 7), onde a média do destino é calculada — lá,
    // zero significa "nenhuma informação de custo viajou", e a média do
    // destino se mantém como está, em vez de ser achatada para zero.
    await tx.transferenciaItem.update({
      where: { id: item.id },
      data: { custoUnit: saldo.custoMedio },
    });
  }

  await tx.transferencia.update({
    where: { id: transferencia.id },
    data: {
      status: 'em_transito',
      expedidaEm: new Date(),
      expedidaPorCompanyUserId: input.autorCompanyUserId,
    },
  });

  await registrarAuditoriaSuprimentos(tx, {
    companyId: input.companyId,
    acao: 'transferencia.expedir',
    alvoTipo: 'suprimentos.transferencia',
    alvoId: transferencia.id,
    atorCompanyUserId: input.autorCompanyUserId,
    antes: { numero: transferencia.numero, status: 'rascunho' },
    depois: { numero: transferencia.numero, status: 'em_transito', itens: itens.length },
  });

  return { transferenciaId: transferencia.id, numero: transferencia.numero, itens: itens.length };
}

export interface EntradaDeRecebimento {
  companyId: string;
  transferenciaId: string;
  autorCompanyUserId: string;
  itens: Array<{ itemId: string; quantidadeRecebida: number; motivoDivergencia?: string | null }>;
}

/**
 * O responsável pelo destino confirma o que chegou. A quantidade entra no
 * físico de lá, e o VALOR viaja junto: o custo que a expedição congelou no
 * item pondera a média do destino (§5.5).
 *
 * Divergência é esperada e NÃO inventa movimento de acerto: o razão já conta
 * a história inteira — saída de 4 em A, entrada de 3 em B —, e gravar uma
 * terceira linha para "fechar a conta" seria inventar uma peça que ninguém
 * viu (§5.3). Confirmar sempre FECHA a transferência, com ou sem divergência:
 * o que não chegou não vem depois.
 *
 * Trava o cabeçalho ANTES de tudo — mesma forma e mesma posição de
 * `cancelarTransferencia`/`expedirTransferencia` — e trava `peca_saldos` do
 * DESTINO ordenando por `compararPorPecaEDeposito`, que desempata por
 * `pecaId` PRIMEIRO. É essa ordem, igual à de `expedirTransferencia`, que
 * impede uma expedição A→B e um recebimento de B→A (peças em comum, saldos
 * em depósitos trocados) de travarem em sentidos contrários e se esperarem
 * em círculo.
 */
export async function receberTransferencia(
  tx: ClienteDaTransacao,
  input: EntradaDeRecebimento,
): Promise<{ transferenciaId: string; numero: string; comDivergencia: number }> {
  // Mesma trava de `cancelarTransferencia`/`expedirTransferencia`, na mesma
  // posição (ORDEM ÚNICA DE TRAVA, topo de `transacao.ts`): sem ela, um
  // recebimento e outro ato sobre o MESMO cabeçalho leem o mesmo status e
  // escrevem os dois.
  await tx.$queryRaw(Prisma.sql`
    SELECT id FROM transferencias
     WHERE id = ${input.transferenciaId}::uuid
       AND company_id = ${input.companyId}::uuid
       FOR UPDATE
  `);

  const transferencia = await tx.transferencia.findFirst({
    where: { id: input.transferenciaId, companyId: input.companyId },
    select: { id: true, numero: true, status: true, depositoDestinoId: true },
  });
  if (!transferencia) {
    throw new NotFoundException('Transferência não encontrada nesta empresa.');
  }
  if (transferencia.status !== 'em_transito') {
    throw new ConflictException(
      `Transferência ${transferencia.status} não está a caminho para ser recebida.`,
    );
  }

  const itens = await tx.transferenciaItem.findMany({
    where: { transferenciaId: transferencia.id },
    select: {
      id: true,
      pecaId: true,
      quantidade: true,
      custoUnit: true,
      peca: { select: { codigoInterno: true } },
    },
  });
  const porId = new Map(itens.map((i) => [i.id, i]));

  // Casa cada entrada do pedido com o item persistido — checagem de FORMA,
  // não de conteúdo, então não precisa esperar a vez de ninguém na ordem de
  // trava. Item de fora desta transferência é recusado antes de tocar
  // `peca_saldos`.
  //
  // Mesmo molde de `criarTransferencia` (peça repetida "some as quantidades
  // numa linha só"): recusa `itemId` repetido, e — o que falta ali por não
  // fazer sentido lá — exige que o conjunto informado seja EXATAMENTE o
  // conjunto de itens do documento. Sem isto, os dois lados escapavam: pedido
  // PARCIAL (informa só parte dos itens, ou lista vazia) fechava a
  // transferência como recebida, com o resto tratado como "chegou tudo" —
  // silêncio, não divergência —, e a origem já tinha baixado o físico dessa
  // peça: ela não entra em depósito nenhum, não vira divergência, e o
  // documento nunca mais pode ser reaberto para corrigir, porque o ato
  // recusa qualquer status diferente de `em_transito`. E `itemId` repetido
  // credita a MESMA peça duas vezes — dois movimentos no razão APPEND-ONLY
  // que ninguém pode apagar depois.
  const vistos = new Set<string>();
  const pedidos = input.itens.map((entrada) => {
    const item = porId.get(entrada.itemId);
    if (!item) {
      throw new BadRequestException('Item não pertence a esta transferência.');
    }
    if (vistos.has(item.id)) {
      throw new BadRequestException(
        `A peça ${item.peca.codigoInterno} foi informada mais de uma vez neste recebimento.`,
      );
    }
    vistos.add(item.id);
    return { item, entrada };
  });
  const faltando = itens.filter((i) => !vistos.has(i.id));
  if (faltando.length > 0) {
    throw new BadRequestException(
      `Faltou confirmar o recebimento de: ${faltando.map((i) => i.peca.codigoInterno).join(', ')}.`,
    );
  }

  // Mesmo comparador de `expedirTransferencia` (ver o comentário de
  // `compararPorPecaEDeposito` em `transacao.ts`): expedição e recebimento
  // tocam linhas em comum de peças que viajam nos dois sentidos entre os
  // mesmos dois depósitos, e é ordenar por `pecaId` PRIMEIRO que garante que
  // os dois lados peguem essas linhas na mesma ordem relativa.
  const ordenados = [...pedidos].sort((a, b) =>
    compararPorPecaEDeposito(
      { pecaId: a.item.pecaId, depositoId: transferencia.depositoDestinoId },
      { pecaId: b.item.pecaId, depositoId: transferencia.depositoDestinoId },
    ),
  );

  let comDivergencia = 0;

  for (const { item, entrada } of ordenados) {
    const quantidade = Number(item.quantidade);
    const recebida = entrada.quantidadeRecebida;
    // `!(x >= 0)` e não `x < 0`: `NaN` falha em qualquer comparação e um
    // `x < 0` sozinho deixaria `NaN` passar como "não negativo". Mesma
    // postura de `criarTransferencia`.
    if (!Number.isFinite(recebida) || !(recebida >= 0)) {
      throw new BadRequestException('Quantidade recebida não pode ser negativa.');
    }
    if (Math.round(recebida * 1000) > Math.round(quantidade * 1000)) {
      throw new BadRequestException(
        `A peça ${item.peca.codigoInterno} não pode chegar em quantidade maior do que saiu.`,
      );
    }
    const motivo = (entrada.motivoDivergencia ?? '').trim();
    const divergiu = temDivergencia({ quantidade, quantidadeRecebida: recebida });
    if (divergiu && !motivo) {
      throw new BadRequestException(
        `A peça ${item.peca.codigoInterno} chegou em quantidade menor — diga por quê.`,
      );
    }
    if (divergiu) comDivergencia += 1;

    await tx.transferenciaItem.update({
      where: { id: item.id },
      data: { quantidadeRecebida: recebida, motivoDivergencia: motivo || null },
    });

    // Chegou zero: não há entrada a gravar em `peca_saldos`, nem movimento —
    // o razão já mostra a saída em A, e é essa a história verdadeira de uma
    // carga perdida. Inventar um movimento de entrada zero não documentaria
    // nada que a saída não documente sozinha.
    if (Math.round(recebida * 1000) === 0) continue;

    // Garante a linha antes de travar — `FOR UPDATE` não trava linha que não
    // existe (mesmo achado de `inventario.ts`/`almoxarifado.service.ts`). Ao
    // contrário da expedição (só entrada anterior cria linha na origem), no
    // DESTINO a peça pode estar chegando pela primeira vez: aqui `upsert` é o
    // certo porque ENTRADA cria linha, ao contrário da SAÍDA.
    await tx.pecaSaldo.upsert({
      where: { pecaId_depositoId: { pecaId: item.pecaId, depositoId: transferencia.depositoDestinoId } },
      create: { pecaId: item.pecaId, depositoId: transferencia.depositoDestinoId },
      update: {},
    });
    await tx.$queryRaw(Prisma.sql`
      SELECT peca_id FROM peca_saldos
       WHERE peca_id = ${item.pecaId}::uuid
         AND deposito_id = ${transferencia.depositoDestinoId}::uuid
         FOR UPDATE
    `);

    // A leitura vem DEPOIS da trava, e não é um detalhe: a escrita abaixo
    // (`saldoFisico: depois`) é um valor ABSOLUTO, não um `increment`. Sem a
    // linha já travada aqui, dois recebimentos concorrentes da MESMA peça no
    // MESMO destino leem o mesmo `saldoFisico` os dois, e o que grava por
    // último sobrescreve com um absoluto calculado sobre um saldo que já não
    // é mais verdade — *lost update*, e nenhum CHECK do banco pega, porque o
    // resultado gravado continua ≥ 0.
    const saldo = await tx.pecaSaldo.findUniqueOrThrow({
      where: { pecaId_depositoId: { pecaId: item.pecaId, depositoId: transferencia.depositoDestinoId } },
      select: { saldoFisico: true, custoMedio: true },
    });
    const anterior = Number(saldo.saldoFisico);
    const depois = Math.round((anterior + recebida) * 1000) / 1000;

    // `item.custoUnit` é o que a expedição congelou da origem — zero
    // inclusive, de propósito (comentário em `expedirTransferencia`). Mas
    // zero AQUI, na hora de ponderar a média do DESTINO, significa "nenhuma
    // informação de custo viajou" — não "a peça não vale nada". `custoMedio`
    // é `Decimal @default(0)`: uma peça que só entrou por contagem de
    // inventário, ou por `darEntrada` sem custo, chega com média zero DE
    // VERDADE. `novoCustoMedio` só tem um caminho que MANTÉM a média do
    // destino: `custoEntrada === null`. Zero não é `null` — se passássemos o
    // zero adiante, a média do destino cairia em silêncio a cada peça sem
    // custo conhecido que chegasse. Por isso ausente OU zero viram `null`
    // aqui: mantém a média do destino como está, em vez de achatá-la.
    const custoQueViajou = item.custoUnit === null ? null : Number(item.custoUnit);
    const custoParaMedia = custoQueViajou === null || custoQueViajou === 0 ? null : custoQueViajou;

    await tx.pecaSaldo.update({
      where: { pecaId_depositoId: { pecaId: item.pecaId, depositoId: transferencia.depositoDestinoId } },
      data: {
        saldoFisico: depois,
        custoMedio: novoCustoMedio(Number(saldo.custoMedio), anterior, recebida, custoParaMedia),
      },
    });

    await tx.estoqueMovimento.create({
      data: {
        companyId: input.companyId,
        pecaId: item.pecaId,
        depositoId: transferencia.depositoDestinoId,
        tipo: 'transferencia',
        quantidade: recebida,
        saldoApos: depois,
        // O movimento registra o valor que de fato viajou, zero inclusive —
        // mesma fidelidade de `expedirTransferencia`. É só na ponderação da
        // média (acima) que o zero vira "sem informação".
        custoUnit: custoQueViajou,
        origemTipo: 'transferencia',
        origemId: transferencia.id,
        autorCompanyUserId: input.autorCompanyUserId,
        observacao: transferencia.numero,
      },
    });
  }

  // Calculado uma vez, e usado nos DOIS lugares abaixo (escrita e rastro):
  // hoje `statusAposRecebimento` sempre devolve `'recebida'`, mas gravar a
  // string cravada no rastro enquanto a escrita usa o valor calculado é uma
  // mentira esperando o dia em que a regra devolver outra coisa, sem teste
  // nenhum para pegar a divergência. A lista vem de `ordenados` — os mesmos
  // itens que o laço acima já processou, e não uma cópia paralela feita só
  // para alimentar este parâmetro (que a regra hoje ignora).
  const status = statusAposRecebimento(
    ordenados.map(({ item, entrada }) => ({
      quantidade: Number(item.quantidade),
      quantidadeRecebida: entrada.quantidadeRecebida,
    })),
  );

  // Status sempre explícito na escrita — nunca herdado do default do schema.
  await tx.transferencia.update({
    where: { id: transferencia.id },
    data: {
      status,
      recebidaEm: new Date(),
      recebidaPorCompanyUserId: input.autorCompanyUserId,
    },
  });

  await registrarAuditoriaSuprimentos(tx, {
    companyId: input.companyId,
    acao: 'transferencia.receber',
    alvoTipo: 'suprimentos.transferencia',
    alvoId: transferencia.id,
    atorCompanyUserId: input.autorCompanyUserId,
    antes: { numero: transferencia.numero, status: 'em_transito' },
    depois: { numero: transferencia.numero, status, comDivergencia },
  });

  return { transferenciaId: transferencia.id, numero: transferencia.numero, comDivergencia };
}
