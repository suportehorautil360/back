import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '../../prisma/generated/client';
import { registrarAuditoriaSuprimentos } from './auditoria';
import {
  formatNumeroTransferencia,
  parseNumeroTransferenciaSeq,
} from './helpers/numero-transferencia.helper';

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
    if (!(Math.round(item.quantidade * 1000) > 0)) {
      throw new BadRequestException('Quantidade tem de ser maior que zero.');
    }
  }

  const depositos = await tx.deposito.findMany({
    where: { id: { in: [input.depositoOrigemId, input.depositoDestinoId] }, companyId: input.companyId },
    select: { id: true },
  });
  if (depositos.length !== 2) {
    throw new NotFoundException('Depósito de origem ou de destino não encontrado nesta empresa.');
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
 */
export async function cancelarTransferencia(
  tx: ClienteDaTransacao,
  input: EntradaDeCancelamentoDeTransferencia,
): Promise<{ transferenciaId: string; numero: string }> {
  const motivo = (input.motivo ?? '').trim();
  if (!motivo) {
    throw new BadRequestException('Cancelar transferência exige motivo.');
  }

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
