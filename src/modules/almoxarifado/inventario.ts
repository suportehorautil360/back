import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '../../prisma/generated/client';
import { registrarAuditoriaSuprimentos } from './auditoria';
import {
  formatNumeroInventario,
  parseNumeroInventarioSeq,
} from './helpers/numero-inventario.helper';
import { ajusteCabeNoSaldo, ajusteDoItem, podeApurar } from './regras/inventario';
import { compararPorPeca } from './transacao';

type ClienteDaTransacao = Prisma.TransactionClient;

export interface EntradaDeAbertura {
  companyId: string;
  depositoId: string;
  pecaIds: string[];
  autorCompanyUserId: string;
  observacao?: string | null;
}

/**
 * Abre a contagem de um depósito. Não trava nada e não congela saldo: a
 * contagem corre junto com a operação, e o que ancora a diferença é o
 * `saldoNaContagem` gravado no momento de CONTAR (§5.2), não aqui.
 *
 * "Uma contagem aberta por depósito" é conferido aqui e garantido pelo índice
 * único parcial — a checagem em código é TOCTOU, e só o índice fecha a corrida.
 */
export async function abrirInventario(
  tx: ClienteDaTransacao,
  input: EntradaDeAbertura,
): Promise<{ id: string; numero: string; itens: number }> {
  const pecaIds = [...new Set(input.pecaIds)];
  if (pecaIds.length === 0) {
    throw new BadRequestException('Escolha ao menos uma peça para contar.');
  }

  const deposito = await tx.deposito.findFirst({
    where: { id: input.depositoId, companyId: input.companyId },
    select: { id: true },
  });
  if (!deposito) {
    throw new NotFoundException('Depósito não encontrado nesta empresa.');
  }

  const aberta = await tx.inventario.findFirst({
    where: { depositoId: input.depositoId, status: 'aberta' },
    select: { numero: true },
  });
  if (aberta) {
    throw new ConflictException(
      `Este depósito já tem a contagem ${aberta.numero} aberta. Apure ou cancele antes de abrir outra.`,
    );
  }

  const encontradas = await tx.peca.findMany({
    where: { id: { in: pecaIds }, companyId: input.companyId, ativo: true },
    select: { id: true },
  });
  if (encontradas.length !== pecaIds.length) {
    throw new BadRequestException(
      'Alguma peça da lista não existe nesta empresa ou está inativa.',
    );
  }

  const ano = new Date().getUTCFullYear();
  const existentes = await tx.inventario.findMany({
    where: { companyId: input.companyId, numero: { startsWith: `INV-${ano}-` } },
    select: { numero: true },
  });
  let maxSeq = 0;
  for (const { numero } of existentes) {
    const seq = parseNumeroInventarioSeq(numero, ano);
    if (seq !== null && seq > maxSeq) maxSeq = seq;
  }
  const numero = formatNumeroInventario(ano, maxSeq + 1);

  const inventario = await tx.inventario.create({
    data: {
      companyId: input.companyId,
      numero,
      depositoId: input.depositoId,
      abertaPorCompanyUserId: input.autorCompanyUserId,
      observacao: input.observacao ?? null,
    },
    select: { id: true, numero: true },
  });

  await tx.inventarioItem.createMany({
    data: pecaIds.map((pecaId) => ({
      inventarioId: inventario.id,
      pecaId,
      quantidadeContada: null,
      saldoNaContagem: null,
    })),
  });

  await registrarAuditoriaSuprimentos(tx, {
    companyId: input.companyId,
    acao: 'inventario.abrir',
    alvoTipo: 'suprimentos.inventario',
    alvoId: inventario.id,
    atorCompanyUserId: input.autorCompanyUserId,
    motivo: input.observacao ?? null,
    depois: { numero, depositoId: input.depositoId, itens: pecaIds.length },
  });

  return { id: inventario.id, numero: inventario.numero, itens: pecaIds.length };
}

export interface EntradaDeContagem {
  companyId: string;
  inventarioItemId: string;
  quantidadeContada: number;
  autorCompanyUserId: string;
}

/**
 * O almoxarife registra o que achou na prateleira.
 *
 * `saldoNaContagem` é lido AQUI, no instante da contagem — é ele que ancora a
 * diferença. Ler na apuração daria a diferença contra um saldo que já mudou, e
 * a contagem passaria a exigir que nada se movesse no meio (§5.2).
 *
 * Sem trava: a contagem é uma anotação, não mexe em saldo. Quem trava é a
 * apuração.
 */
export async function registrarContagem(
  tx: ClienteDaTransacao,
  input: EntradaDeContagem,
): Promise<{ itemId: string; quantidadeContada: number; saldoNaContagem: number }> {
  // `!(x >= 0)` e não `x < 0`: NaN falha em qualquer comparação e passaria.
  if (!(input.quantidadeContada >= 0)) {
    throw new BadRequestException('Quantidade contada não pode ser negativa.');
  }

  const item = await tx.inventarioItem.findFirst({
    where: { id: input.inventarioItemId, inventario: { companyId: input.companyId } },
    include: { inventario: { select: { id: true, status: true, depositoId: true } } },
  });
  if (!item) {
    throw new NotFoundException('Item de contagem não encontrado nesta empresa.');
  }
  if (item.inventario.status !== 'aberta') {
    throw new ConflictException(
      `Contagem ${item.inventario.status} não aceita mais registro.`,
    );
  }

  // Peça sem linha de saldo conta contra ZERO: ela nunca existiu neste
  // depósito, e achar três unidades dela é uma entrada de três.
  const saldo = await tx.pecaSaldo.findUnique({
    where: { pecaId_depositoId: { pecaId: item.pecaId, depositoId: item.inventario.depositoId } },
    select: { saldoFisico: true },
  });
  const saldoNaContagem = Number(saldo?.saldoFisico ?? 0);

  await tx.inventarioItem.update({
    where: { id: item.id },
    data: {
      quantidadeContada: input.quantidadeContada,
      saldoNaContagem,
      contadaPorCompanyUserId: input.autorCompanyUserId,
      contadaEm: new Date(),
    },
  });

  return {
    itemId: item.id,
    quantidadeContada: input.quantidadeContada,
    saldoNaContagem,
  };
}

export interface EntradaDeApuracao {
  companyId: string;
  inventarioId: string;
  autorCompanyUserId: string;
  motivo: string;
}

/**
 * Fecha a contagem: a diferença de cada item vira movimento de ajuste.
 *
 * A diferença é aplicada como DELTA ao saldo de AGORA, não como valor
 * absoluto. Ela é um fato sobre o instante da contagem, e o que se moveu no
 * meio continua valendo — é isso que permite contar sem parar a operação.
 *
 * Ordem única de trava: o cabeçalho do inventário e depois `peca_saldos` por
 * `pecaId` (`compararPorPeca`). Todos os saldos são do MESMO depósito, então
 * `pecaId` já dá ordem total — o desempate por depósito que a transferência
 * exige não é necessário aqui.
 */
export async function apurarInventario(
  tx: ClienteDaTransacao,
  input: EntradaDeApuracao,
): Promise<{ inventarioId: string; ajustados: number; semDiferenca: number }> {
  const motivo = (input.motivo ?? '').trim();
  if (!motivo) {
    throw new BadRequestException('Diga o que esta contagem apurou — fica na auditoria.');
  }

  await tx.$queryRaw(Prisma.sql`
    SELECT id FROM inventarios
     WHERE id = ${input.inventarioId}::uuid
       AND company_id = ${input.companyId}::uuid
       FOR UPDATE
  `);

  const inventario = await tx.inventario.findFirst({
    where: { id: input.inventarioId, companyId: input.companyId },
    select: { id: true, numero: true, status: true, depositoId: true },
  });
  if (!inventario) {
    throw new NotFoundException('Contagem não encontrada nesta empresa.');
  }
  if (inventario.status !== 'aberta') {
    throw new ConflictException(`Contagem ${inventario.status} não apura de novo.`);
  }

  const itens = await tx.inventarioItem.findMany({
    where: { inventarioId: inventario.id },
    select: { id: true, pecaId: true, quantidadeContada: true, saldoNaContagem: true },
  });
  const comoNumero = itens.map((i) => ({
    ...i,
    quantidadeContada: i.quantidadeContada === null ? null : Number(i.quantidadeContada),
    saldoNaContagem: i.saldoNaContagem === null ? null : Number(i.saldoNaContagem),
  }));
  if (!podeApurar(comoNumero)) {
    throw new BadRequestException('Nenhum item foi contado — não há o que apurar.');
  }

  const contados = comoNumero
    .filter((i) => ajusteDoItem(i) !== null)
    .sort((a, b) => compararPorPeca(a.pecaId, b.pecaId));

  let ajustados = 0;
  let semDiferenca = 0;

  for (const item of contados) {
    const ajuste = ajusteDoItem(item) as number;

    if (ajuste === 0) {
      semDiferenca += 1;
      await tx.inventarioItem.update({ where: { id: item.id }, data: { ajuste: 0 } });
      continue;
    }

    // Garante a linha antes de travar: `FOR UPDATE` não trava linha que não
    // existe — mesmo achado (C2) de `darEntrada`.
    await tx.pecaSaldo.upsert({
      where: { pecaId_depositoId: { pecaId: item.pecaId, depositoId: inventario.depositoId } },
      create: { pecaId: item.pecaId, depositoId: inventario.depositoId },
      update: {},
    });
    await tx.$queryRaw(Prisma.sql`
      SELECT peca_id FROM peca_saldos
       WHERE peca_id = ${item.pecaId}::uuid
         AND deposito_id = ${inventario.depositoId}::uuid
         FOR UPDATE
    `);

    const saldo = await tx.pecaSaldo.findUniqueOrThrow({
      where: { pecaId_depositoId: { pecaId: item.pecaId, depositoId: inventario.depositoId } },
      select: { saldoFisico: true, saldoReservado: true, custoMedio: true },
    });
    const atual = {
      saldoFisico: Number(saldo.saldoFisico),
      saldoReservado: Number(saldo.saldoReservado),
    };
    if (!ajusteCabeNoSaldo(atual, ajuste)) {
      throw new ConflictException(
        `A contagem desta peça achou menos do que já está reservado para uma OS. ` +
          `Trate a reserva antes de acertar o saldo.`,
      );
    }

    const depois = Math.round((atual.saldoFisico + ajuste) * 1000) / 1000;
    await tx.pecaSaldo.update({
      where: { pecaId_depositoId: { pecaId: item.pecaId, depositoId: inventario.depositoId } },
      data: { saldoFisico: depois },
    });

    // A média NÃO muda: achar unidade a mais é erro de contagem, não compra a
    // preço novo. `custoUnit` sai da média do depósito só para o razão poder
    // valorizar o movimento.
    const movimento = await tx.estoqueMovimento.create({
      data: {
        companyId: input.companyId,
        pecaId: item.pecaId,
        depositoId: inventario.depositoId,
        tipo: 'ajuste',
        quantidade: ajuste,
        saldoApos: depois,
        custoUnit: saldo.custoMedio,
        origemTipo: 'inventario',
        origemId: inventario.id,
        autorCompanyUserId: input.autorCompanyUserId,
        observacao: `${inventario.numero}: ${motivo}`,
      },
      select: { id: true },
    });

    await tx.inventarioItem.update({
      where: { id: item.id },
      data: { ajuste, movimentoId: movimento.id },
    });
    ajustados += 1;
  }

  await tx.inventario.update({
    where: { id: inventario.id },
    data: {
      status: 'apurada',
      apuradaPorCompanyUserId: input.autorCompanyUserId,
      apuradaEm: new Date(),
    },
  });

  await registrarAuditoriaSuprimentos(tx, {
    companyId: input.companyId,
    acao: 'inventario.apurar',
    alvoTipo: 'suprimentos.inventario',
    alvoId: inventario.id,
    atorCompanyUserId: input.autorCompanyUserId,
    motivo,
    depois: { numero: inventario.numero, ajustados, semDiferenca },
  });

  return { inventarioId: inventario.id, ajustados, semDiferenca };
}
