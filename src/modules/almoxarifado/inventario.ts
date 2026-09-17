import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '../../prisma/generated/client';
import { registrarAuditoriaSuprimentos } from './auditoria';
import {
  formatNumeroInventario,
  parseNumeroInventarioSeq,
} from './helpers/numero-inventario.helper';

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
