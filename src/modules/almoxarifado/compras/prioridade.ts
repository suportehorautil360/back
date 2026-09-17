import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '../../../prisma/generated/client';
import { registrarAuditoriaSuprimentos } from '../auditoria';
import { PRIORIDADES, type Prioridade } from '../regras/compras';

type ClienteDaTransacao = Prisma.TransactionClient;

/** Solicitação encerrada não tem fila para disputar. */
const SOLICITACAO_ABERTA = new Set(['pendente', 'em_cotacao', 'aprovada']);

/** Menor é mais urgente — o mesmo de `RANK_PRIORIDADE` em `regras/compras.ts`. */
const RANK: Record<string, number> = { critica: 0, alta: 1, normal: 2, reposicao: 3 };

export interface EntradaDePrioridade {
  companyId: string;
  solicitacaoItemId: string;
  prioridade: string;
  autorCompanyUserId: string;
  motivo: string;
}

export interface ResultadoDePrioridade {
  solicitacaoItemId: string;
  solicitacaoId: string;
  prioridade: string;
  /** O cabeçalho depois do recálculo — é ele que a fila mostra. */
  prioridadeDaSolicitacao: string;
}

/**
 * Critério 10: alterar a prioridade exige permissão (o gate da rota), motivo e
 * log.
 *
 * Altera o ITEM, não o cabeçalho, porque é a prioridade do item que decide
 * quem recebe a peça que chega (`compararLugarNaFila`, §8). O cabeçalho é o
 * MÁXIMO dos itens vivos — é assim que ele nasce (`critica` se alguma falta é
 * impeditiva, senão `alta`), e recalculá-lo mantém essa verdade.
 *
 * Gravar no cabeçalho a prioridade do item alterado seria o caminho fácil e
 * errado: uma linha comum rebaixada levaria junto a solicitação inteira, e a
 * peça que está parando uma máquina sumiria do topo da fila.
 */
export async function alterarPrioridadeDoItem(
  tx: ClienteDaTransacao,
  input: EntradaDePrioridade,
): Promise<ResultadoDePrioridade> {
  const motivo = (input.motivo ?? '').trim();
  if (!motivo) {
    throw new BadRequestException(
      'Diga por que a prioridade muda — fica na auditoria.',
    );
  }
  if (!PRIORIDADES.includes(input.prioridade as Prioridade)) {
    throw new BadRequestException(
      `Prioridade inválida. Use uma de: ${PRIORIDADES.join(', ')}.`,
    );
  }

  // Ordem única de trava do módulo: linha de item ANTES do cabeçalho.
  await tx.$queryRaw(Prisma.sql`
    SELECT id FROM solicitacao_compra_itens
     WHERE id = ${input.solicitacaoItemId}::uuid
       FOR UPDATE
  `);

  const item = await tx.solicitacaoCompraItem.findFirst({
    where: { id: input.solicitacaoItemId, solicitacao: { companyId: input.companyId } },
    include: { solicitacao: { select: { id: true, status: true, prioridade: true } } },
  });
  if (!item) {
    throw new NotFoundException('Item de solicitação não encontrado nesta empresa.');
  }
  if (!SOLICITACAO_ABERTA.has(item.solicitacao.status)) {
    throw new ConflictException(
      `Solicitação ${item.solicitacao.status} não tem prioridade a mudar.`,
    );
  }

  await tx.$queryRaw(Prisma.sql`
    SELECT id FROM solicitacoes_compra
     WHERE id = ${item.solicitacao.id}::uuid
       FOR UPDATE
  `);

  const antes = item.prioridade;
  await tx.solicitacaoCompraItem.update({
    where: { id: item.id },
    data: { prioridade: input.prioridade },
  });

  // O cabeçalho é o MÁXIMO dos itens vivos, relido depois da escrita.
  const vivos = await tx.solicitacaoCompraItem.findMany({
    where: { solicitacaoId: item.solicitacao.id, status: { not: 'cancelada' } },
    select: { prioridade: true },
  });
  const doCabecalho = vivos.reduce(
    (maior, i) => ((RANK[i.prioridade] ?? 99) < (RANK[maior] ?? 99) ? i.prioridade : maior),
    vivos[0]?.prioridade ?? input.prioridade,
  );
  await tx.solicitacaoCompra.update({
    where: { id: item.solicitacao.id },
    data: { prioridade: doCabecalho },
  });

  await registrarAuditoriaSuprimentos(tx, {
    companyId: input.companyId,
    acao: 'solicitacao_compra.prioridade',
    alvoTipo: 'suprimentos.solicitacao_compra',
    alvoId: item.solicitacao.id,
    atorCompanyUserId: input.autorCompanyUserId,
    motivo,
    antes: { itemId: item.id, prioridade: antes, prioridadeDaSolicitacao: item.solicitacao.prioridade },
    depois: { itemId: item.id, prioridade: input.prioridade, prioridadeDaSolicitacao: doCabecalho },
  });

  return {
    solicitacaoItemId: item.id,
    solicitacaoId: item.solicitacao.id,
    prioridade: input.prioridade,
    prioridadeDaSolicitacao: doCabecalho,
  };
}
