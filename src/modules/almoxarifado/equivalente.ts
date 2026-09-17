import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../../prisma/generated/client';
import { registrarAuditoriaSuprimentos } from './auditoria';
import { compararPorPeca, travarRequisicao } from './transacao';

type ClienteDaTransacao = Prisma.TransactionClient;

/** Os dois estados em que a requisição ainda admite mexer no kit. */
const REQUISICAO_ABERTA = new Set(['pendente', 'em_separacao']);

/**
 * `Peca.equivalentes` é Json e pode vir de qualquer jeito do banco. Ler com
 * desconfiança custa três linhas e evita que um cadastro estranho vire
 * exceção de tipo no meio de uma transação.
 */
function listaDeEquivalentes(
  valor: Prisma.JsonValue | null | undefined,
): string[] {
  return Array.isArray(valor)
    ? valor.filter((v): v is string => typeof v === 'string')
    : [];
}

export interface EntradaDeProposta {
  companyId: string;
  requisicaoId: string;
  itemId: string;
  pecaEquivalenteId: string;
  autorCompanyUserId: string;
  motivo?: string | null;
}

export interface ResultadoDaProposta {
  itemId: string;
  status: string;
  pecaId: string;
  equivalenteDePecaId: string;
}

/**
 * O almoxarife propõe trocar a peça que falta por uma equivalente que ele tem
 * na prateleira. A troca NÃO acontece aqui: quem decide se a peça de outra
 * marca serve naquela máquina é a mecânica (critério 11), e é ela que aprova.
 *
 * Por que o item já passa a apontar para a equivalente: `equivalenteDePecaId`
 * guarda de qual peça ela é substituta, então o par (status, equivalenteDe) diz
 * sem ambiguidade "esta linha mostra uma proposta, ainda não aceita" — e a
 * recusa restaura o original a partir dele. É o que evita uma coluna nova só
 * para carregar a proposta.
 */
export async function proporEquivalente(
  tx: ClienteDaTransacao,
  input: EntradaDeProposta,
): Promise<ResultadoDaProposta> {
  await travarRequisicao(tx, input.requisicaoId, input.companyId);

  const req = await tx.requisicaoMaterial.findUniqueOrThrow({
    where: { id: input.requisicaoId },
    select: { status: true },
  });
  if (!REQUISICAO_ABERTA.has(req.status)) {
    throw new ConflictException(
      `Requisição ${req.status} não aceita proposta de equivalente.`,
    );
  }

  const item = await tx.requisicaoMaterialItem.findFirst({
    where: { id: input.itemId, requisicaoId: input.requisicaoId },
  });
  if (!item)
    throw new NotFoundException('Item não encontrado nesta requisição.');
  if (item.status !== 'faltante') {
    throw new ConflictException(
      `Só item faltante tem troca a propor — este está ${item.status}.`,
    );
  }
  const original = item.pecaId;
  if (!original) {
    throw new BadRequestException(
      'Item sem peça vinculada não tem equivalente a propor.',
    );
  }
  if (original === input.pecaEquivalenteId) {
    throw new BadRequestException('A peça proposta é a própria peça do item.');
  }

  const peca = await tx.peca.findFirst({
    where: { id: original, companyId: input.companyId },
    select: { equivalentes: true },
  });
  if (!peca)
    throw new NotFoundException('Peça do item não encontrada nesta empresa.');
  // A lista do catálogo é a única fonte do que é equivalente a quê. Sem esta
  // trava, "equivalente" vira qualquer peça, e a aprovação técnica passa a
  // decidir sobre uma troca que ninguém cadastrou.
  if (
    !listaDeEquivalentes(peca.equivalentes).includes(input.pecaEquivalenteId)
  ) {
    throw new BadRequestException(
      'A peça proposta não está cadastrada como equivalente desta.',
    );
  }

  const equivalente = await tx.peca.findFirst({
    where: { id: input.pecaEquivalenteId, companyId: input.companyId },
    select: { ativo: true },
  });
  if (!equivalente) {
    throw new BadRequestException(
      'Peça equivalente não encontrada nesta empresa.',
    );
  }
  if (!equivalente.ativo) {
    throw new BadRequestException('Peça equivalente está inativa.');
  }

  await tx.requisicaoMaterialItem.update({
    where: { id: item.id },
    data: {
      pecaId: input.pecaEquivalenteId,
      equivalenteDePecaId: original,
      status: 'aguardando_equivalente',
    },
  });

  await registrarAuditoriaSuprimentos(tx, {
    companyId: input.companyId,
    acao: 'requisicao.equivalente_proposto',
    alvoTipo: 'suprimentos.requisicao',
    alvoId: input.requisicaoId,
    atorCompanyUserId: input.autorCompanyUserId,
    motivo: input.motivo ?? null,
    antes: { itemId: item.id, pecaId: original, status: item.status },
    depois: {
      itemId: item.id,
      pecaId: input.pecaEquivalenteId,
      status: 'aguardando_equivalente',
    },
  });

  return {
    itemId: item.id,
    status: 'aguardando_equivalente',
    pecaId: input.pecaEquivalenteId,
    equivalenteDePecaId: original,
  };
}

export interface EntradaDeDecisao {
  companyId: string;
  requisicaoId: string;
  itemId: string;
  /** `false` é a recusa técnica: a peça de outra marca não serve. */
  aprovar: boolean;
  autorCompanyUserId: string;
  motivo?: string | null;
}

export interface ResultadoDaDecisao {
  itemId: string;
  aprovado: boolean;
  status: string;
  /** Verdadeiro quando a aprovação caiu por falta de saldo, não por decisão. */
  semSaldo?: boolean;
}

/**
 * A mecânica decide se a peça de outra marca serve naquela máquina — o
 * critério 11. Aprovar aqui é RESERVAR, não consultar: entre a proposta e esta
 * decisão outra OS pode ter levado o saldo da equivalente, e aprovar contra um
 * número lido antes deixaria o item "reservado" sem nada reservado de verdade.
 *
 * Por isso o saldo insuficiente NÃO é exceção: é o mesmo desfecho da recusa —
 * o item volta a faltante com a peça original, e segue o caminho normal da
 * falta. Lançar aqui deixaria o item preso em `aguardando_equivalente` para
 * sempre, que é o único estado do qual ele não sai sozinho.
 */
export async function decidirEquivalente(
  tx: ClienteDaTransacao,
  input: EntradaDeDecisao,
): Promise<ResultadoDaDecisao> {
  await travarRequisicao(tx, input.requisicaoId, input.companyId);

  const item = await tx.requisicaoMaterialItem.findFirst({
    where: { id: input.itemId, requisicaoId: input.requisicaoId },
  });
  if (!item)
    throw new NotFoundException('Item não encontrado nesta requisição.');
  if (item.status !== 'aguardando_equivalente') {
    throw new ConflictException(
      `Só item esperando aprovação tem decisão a receber — este está ${item.status}.`,
    );
  }
  const equivalenteId = item.pecaId;
  const originalId = item.equivalenteDePecaId;
  if (!equivalenteId || !originalId) {
    throw new ConflictException(
      'Item em proposta sem as duas peças — estado inconsistente.',
    );
  }

  const req = await tx.requisicaoMaterial.findUniqueOrThrow({
    where: { id: input.requisicaoId },
    select: { depositoId: true },
  });

  // A ORDEM ÚNICA DE TRAVA do módulo: requisição (acima) e depois
  // `peca_saldos` por `pecaId`. As duas peças entram ordenadas porque uma
  // transação que trava duas linhas em ordem livre deadlocka com a sua
  // simétrica — aqui, a aprovação da troca inversa.
  for (const pecaId of [originalId, equivalenteId].sort(compararPorPeca)) {
    await tx.$queryRaw(Prisma.sql`
      SELECT peca_id FROM peca_saldos
       WHERE peca_id = ${pecaId}::uuid
         AND deposito_id = ${req.depositoId}::uuid
         FOR UPDATE
    `);
  }

  const querida = Number(item.quantidadeSolicitada);
  const presaNaOriginal = Number(item.quantidadeReservada);

  let reservou = false;
  if (input.aprovar) {
    const gravado = await tx.$executeRaw(Prisma.sql`
      UPDATE peca_saldos
         SET saldo_reservado = saldo_reservado + ${querida},
             updated_at = now()
       WHERE peca_id = ${equivalenteId}::uuid
         AND deposito_id = ${req.depositoId}::uuid
         AND saldo_fisico - saldo_reservado >= ${querida}
    `);
    reservou = gravado === 1;
  }

  if (reservou) {
    if (presaNaOriginal > 0) {
      await tx.$executeRaw(Prisma.sql`
        UPDATE peca_saldos
           SET saldo_reservado = saldo_reservado - ${presaNaOriginal},
               updated_at = now()
         WHERE peca_id = ${originalId}::uuid
           AND deposito_id = ${req.depositoId}::uuid
      `);
    }
    await tx.requisicaoMaterialItem.update({
      where: { id: item.id },
      data: { quantidadeReservada: querida, status: 'reservada' },
    });
  } else {
    // Recusa (técnica ou por saldo): o item volta a ser o que era. A peça
    // original está em `equivalenteDePecaId` — é dela que ele se restaura.
    await tx.requisicaoMaterialItem.update({
      where: { id: item.id },
      data: {
        pecaId: originalId,
        equivalenteDePecaId: null,
        status: 'faltante',
      },
    });
  }

  const acao = reservou
    ? 'requisicao.equivalente_aprovado'
    : input.aprovar
      ? 'requisicao.equivalente_sem_saldo'
      : 'requisicao.equivalente_recusado';
  await registrarAuditoriaSuprimentos(tx, {
    companyId: input.companyId,
    acao,
    alvoTipo: 'suprimentos.requisicao',
    alvoId: input.requisicaoId,
    atorCompanyUserId: input.autorCompanyUserId,
    motivo: input.motivo ?? null,
    antes: {
      itemId: item.id,
      pecaId: equivalenteId,
      status: 'aguardando_equivalente',
    },
    depois: {
      itemId: item.id,
      pecaId: reservou ? equivalenteId : originalId,
      status: reservou ? 'reservada' : 'faltante',
    },
  });

  return {
    itemId: item.id,
    aprovado: reservou,
    status: reservou ? 'reservada' : 'faltante',
    ...(input.aprovar && !reservou ? { semSaldo: true } : {}),
  };
}
