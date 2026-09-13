import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '../../../prisma/generated/client';
import { compararPorPeca, travarRequisicao } from '../transacao';
import {
  ESTADOS_DE_COMPRA,
  acaoPermitida,
  distribuirRecebimento,
  faltaDoItem,
  statusDaOrdemAposRecebimento,
  type FaltaParaDistribuir,
  type OrigemParaDistribuir,
} from '../regras/compras';
import { novoCustoMedio } from '../regras/movimento';
import { statusAposConsulta } from '../regras/status-materiais';
import { refinarPelaCompra } from './cobertura';
import { recalcularEstadoDaSolicitacao } from './estado-da-solicitacao';
import { montarNotificacoesDoRecebimento } from './notificacoes-recebimento';
import { registrarAuditoriaSuprimentos } from '../auditoria';
import type { NotificacaoPronta } from '../notificacoes/almoxarifado-notificacoes';

export interface ItemRecebido {
  ordemCompraItemId: string;
  /** O que ENTROU no estoque. */
  quantidadeRecebida: number;
  /** O que veio e foi recusado na conferência — não entra e não consome o pedido. */
  quantidadeRecusada: number;
  /** Preço da nota; nulo = vale o da OC. */
  valorUnit: number | null;
  lote: string | null;
  validade: Date | null;
  divergencia: string | null;
}

export interface EntradaDeRecebimento {
  companyId: string;
  autorCompanyUserId: string;
  ordemCompraId: string;
  notaFiscalNumero: string | null;
  notaFiscalChave: string | null;
  observacao: string | null;
  itens: ItemRecebido[];
}

export interface ResultadoDoRecebimento {
  recebimentoId: string;
  statusOrdemCompra: string;
}

const REQUISICAO_FECHADA = new Set(['entregue', 'cancelada']);

function milesimos(n: number): number {
  return Math.round(n * 1000);
}

/**
 * Validação de FORMA do pedido — roda antes de qualquer leitura do banco.
 * Recusar no meio da transação deixaria o almoxarife sem saber o que foi
 * aceito; e o que depende de estado (quanto está pendente) é conferido depois
 * da trava, em `executarRecebimento`.
 */
export function validarEntradaDeRecebimento(input: EntradaDeRecebimento): void {
  if (input.itens.length === 0) {
    throw new BadRequestException('Informe ao menos um item recebido.');
  }
  const vistos = new Set<string>();
  for (const i of input.itens) {
    if (vistos.has(i.ordemCompraItemId)) {
      throw new BadRequestException(`Item ${i.ordemCompraItemId} repetido no mesmo recebimento.`);
    }
    vistos.add(i.ordemCompraItemId);
    // `!(x >= 0)` e não `x < 0`: NaN falha em qualquer comparação e passaria.
    if (!(milesimos(i.quantidadeRecebida) >= 0) || !(milesimos(i.quantidadeRecusada) >= 0)) {
      throw new BadRequestException('Quantidade recebida e recusada não podem ser negativas.');
    }
    if (milesimos(i.quantidadeRecebida) + milesimos(i.quantidadeRecusada) === 0) {
      throw new BadRequestException('Cada linha do recebimento precisa de quantidade recebida ou recusada.');
    }
    if (milesimos(i.quantidadeRecusada) > 0 && !(i.divergencia ?? '').trim()) {
      throw new BadRequestException('Recusa exige descrever a divergência — o comprador precisa dela para reclamar com o fornecedor.');
    }
  }
}

/**
 * O corpo da transação do recebimento de uma ordem de compra — a única
 * escrita de saldo de Compras, e por isso no molde das quatro da F3.
 *
 * Ordem única de trava: cabeçalho da OC → requisições (por id) → linhas de
 * item de solicitação (por id) → `peca_saldos` (por `pecaId`) → OS.
 *
 * Para quem vai a peça: primeiro as faltas ligadas às origens desta OC,
 * depois qualquer outra falta da mesma peça no mesmo depósito, na ordem do §8
 * (`distribuirRecebimento`). O que sobra fica livre na prateleira.
 *
 * Tudo que decide é relido DEPOIS das travas: o estado da OC, o pendente de
 * cada item e origem, o estado de cada item de solicitação e a falta de cada
 * item de requisição. Nada lido fora da transação entra numa conta de saldo.
 */
export async function executarRecebimento(
  tx: Prisma.TransactionClient,
  input: EntradaDeRecebimento,
): Promise<{ resultado: ResultadoDoRecebimento; notificacoes: NotificacaoPronta[] }> {
  // 1. Trava a OC e relê tudo dela.
  const ocTravada = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
    SELECT id FROM ordens_compra
     WHERE id = ${input.ordemCompraId}::uuid
       AND company_id = ${input.companyId}::uuid
       FOR UPDATE
  `);
  if (!ocTravada[0]) throw new NotFoundException('Ordem de compra não encontrada para esta empresa.');

  const oc = await tx.ordemCompra.findUniqueOrThrow({
    where: { id: input.ordemCompraId },
    select: {
      id: true,
      numero: true,
      status: true,
      depositoId: true,
      itens: {
        select: {
          id: true,
          pecaId: true,
          quantidade: true,
          quantidadeRecebida: true,
          valorUnit: true,
          origens: {
            select: {
              id: true,
              quantidade: true,
              quantidadeRecebida: true,
              solicitacaoCompraItem: {
                select: {
                  id: true,
                  solicitacaoId: true,
                  prioridade: true,
                  dataNecessidade: true,
                  createdAt: true,
                  requisicaoItemId: true,
                  requisicaoItem: { select: { requisicaoId: true } },
                },
              },
            },
          },
        },
      },
    },
  });
  if (!acaoPermitida(oc.status, 'receber')) {
    throw new ConflictException(`Ordem de compra "${oc.status}" não aceita recebimento.`);
  }

  const itemDaOc = new Map(oc.itens.map((i) => [i.id, i]));
  const linhas = input.itens.map((entrada) => {
    const item = itemDaOc.get(entrada.ordemCompraItemId);
    if (!item) throw new BadRequestException(`Item ${entrada.ordemCompraItemId} não é desta ordem de compra.`);
    const pendente = milesimos(Number(item.quantidade)) - milesimos(Number(item.quantidadeRecebida));
    if (milesimos(entrada.quantidadeRecebida) > pendente) {
      throw new BadRequestException(
        `Recebido acima do pendente: faltam ${pendente / 1000} deste item na ${oc.numero}.`,
      );
    }
    return { entrada, item };
  });
  const comEntrada = linhas.filter((l) => milesimos(l.entrada.quantidadeRecebida) > 0);
  const pecasQueEntram = [...new Set(comEntrada.map((l) => l.item.pecaId))];

  // 2. Quem pode receber a peça: as faltas das origens e as outras faltas da
  //    mesma peça neste depósito ("quem pediu, depois quem precisa").
  const outrasFaltas = pecasQueEntram.length
    ? await tx.requisicaoMaterialItem.findMany({
        where: {
          pecaId: { in: pecasQueEntram },
          status: 'faltante',
          requisicao: {
            companyId: input.companyId,
            depositoId: oc.depositoId,
            status: { notIn: ['entregue', 'cancelada'] },
          },
        },
        select: {
          id: true,
          requisicaoId: true,
          pecaId: true,
          prioridade: true,
          dataNecessidade: true,
          createdAt: true,
          solicitacaoCompraItens: {
            where: { status: { not: 'cancelada' } },
            select: { prioridade: true, dataNecessidade: true, createdAt: true },
          },
        },
      })
    : [];
  const origensQueRecebem = comEntrada.flatMap((l) => l.item.origens);
  const requisicaoIds = [
    ...new Set([
      ...origensQueRecebem
        .map((o) => o.solicitacaoCompraItem.requisicaoItem?.requisicaoId)
        .filter((id): id is string => Boolean(id)),
      ...outrasFaltas.map((f) => f.requisicaoId),
    ]),
  ].sort();

  // 3. Trava as requisições, depois as linhas de item de solicitação.
  for (const requisicaoId of requisicaoIds) {
    await travarRequisicao(tx, requisicaoId, input.companyId);
  }
  const itensDeSolicitacaoIds = [...new Set(origensQueRecebem.map((o) => o.solicitacaoCompraItem.id))].sort();
  if (itensDeSolicitacaoIds.length) {
    await tx.$queryRaw(Prisma.sql`
      SELECT id FROM solicitacao_compra_itens
       WHERE id = ANY(${itensDeSolicitacaoIds}::uuid[])
       ORDER BY id
         FOR UPDATE
    `);
  }

  // 4. Relê com as travas na mão: quais itens de solicitação ainda estão
  //    abertos, e a falta viva de cada item de requisição.
  const solicitacoesAbertas = new Set(
    (itensDeSolicitacaoIds.length
      ? await tx.solicitacaoCompraItem.findMany({
          where: { id: { in: itensDeSolicitacaoIds }, status: 'aberta' },
          select: { id: true },
        })
      : []
    ).map((s) => s.id),
  );
  const requisicaoItemIds = [
    ...new Set([
      ...origensQueRecebem
        .map((o) => o.solicitacaoCompraItem.requisicaoItemId)
        .filter((id): id is string => Boolean(id)),
      ...outrasFaltas.map((f) => f.id),
    ]),
  ];
  const faltantesFrescos = requisicaoItemIds.length
    ? await tx.requisicaoMaterialItem.findMany({
        where: { id: { in: requisicaoItemIds } },
        select: {
          id: true,
          requisicaoId: true,
          pecaId: true,
          status: true,
          quantidadeSolicitada: true,
          quantidadeReservada: true,
          requisicao: { select: { status: true, companyId: true, depositoId: true } },
        },
      })
    : [];
  const faltanteFresco = new Map(faltantesFrescos.map((f) => [f.id, f]));
  const faltaAtual: Record<string, number> = {};
  for (const f of faltantesFrescos) {
    // Requisição fechada, de outra empresa ou de outro depósito não recebe
    // reserva desta entrada — a peça fica livre.
    const recebe =
      !REQUISICAO_FECHADA.has(f.requisicao.status) &&
      f.requisicao.companyId === input.companyId &&
      f.requisicao.depositoId === oc.depositoId;
    faltaAtual[f.id] = recebe
      ? faltaDoItem({
          status: f.status,
          quantidadeSolicitada: Number(f.quantidadeSolicitada),
          quantidadeReservada: Number(f.quantidadeReservada),
        })
      : 0;
  }

  // 5. O documento do recebimento — o id dele é a origem dos movimentos.
  const recebimento = await tx.recebimento.create({
    data: {
      companyId: input.companyId,
      ordemCompraId: oc.id,
      depositoId: oc.depositoId,
      notaFiscalNumero: input.notaFiscalNumero,
      notaFiscalChave: input.notaFiscalChave,
      recebidoPorCompanyUserId: input.autorCompanyUserId,
      observacao: input.observacao,
    },
    select: { id: true },
  });

  // 6. Por peça, na ordem única de trava de `peca_saldos`.
  const requisicoesQueGanharamPeca = new Set<string>();
  const requisicoesComItemCompleto = new Set<string>();
  for (const { entrada, item } of [...linhas].sort((a, b) => compararPorPeca(a.item.pecaId, b.item.pecaId))) {
    const quantidade = entrada.quantidadeRecebida;

    if (milesimos(quantidade) > 0) {
      // A linha existe: a emissão da OC a cria (`upsert`) ao somar o
      // `saldo_em_compra`. Linha ausente aqui é estado quebrado, e lança em vez
      // de criar um saldo do zero que o `saldo_em_compra -` levaria ao CHECK.
      const travado = await tx.$queryRaw<{ peca_id: string }[]>(Prisma.sql`
        SELECT peca_id FROM peca_saldos
         WHERE peca_id = ${item.pecaId}::uuid
           AND deposito_id = ${oc.depositoId}::uuid
           FOR UPDATE
      `);
      if (!travado[0]) {
        throw new Error(
          `Saldo não encontrado para peça ${item.pecaId} no depósito ${oc.depositoId} ao receber — estado inconsistente.`,
        );
      }
      const saldo = await tx.pecaSaldo.findUniqueOrThrow({
        where: { pecaId_depositoId: { pecaId: item.pecaId, depositoId: oc.depositoId } },
        select: { saldoFisico: true },
      });
      const saldoAnterior = Number(saldo.saldoFisico);

      const origens: OrigemParaDistribuir[] = item.origens.map((o) => ({
        id: o.id,
        prioridade: o.solicitacaoCompraItem.prioridade,
        dataNecessidade: o.solicitacaoCompraItem.dataNecessidade,
        pedidoEm: o.solicitacaoCompraItem.createdAt,
        pendente: Number(o.quantidade) - Number(o.quantidadeRecebida),
        requisicaoItemId: solicitacoesAbertas.has(o.solicitacaoCompraItem.id)
          ? o.solicitacaoCompraItem.requisicaoItemId
          : null,
      }));
      const outrasDaPeca: FaltaParaDistribuir[] = outrasFaltas
        .filter((f) => f.pecaId === item.pecaId)
        .map((f) => {
          const sc = f.solicitacaoCompraItens[0];
          return {
            id: f.id,
            requisicaoItemId: f.id,
            prioridade: sc?.prioridade ?? f.prioridade,
            dataNecessidade: sc?.dataNecessidade ?? f.dataNecessidade,
            pedidoEm: sc?.createdAt ?? f.createdAt,
          };
        });
      const distribuicao = distribuirRecebimento({
        quantidade,
        origens,
        faltaAtual,
        outrasFaltas: outrasDaPeca,
      });
      const reservado =
        distribuicao.reservas.reduce((soma, r) => soma + milesimos(r.quantidade), 0) / 1000;

      // Saldo: aritmética RELATIVA, as três colunas numa escrita só, sob a trava.
      await tx.$executeRaw(Prisma.sql`
        UPDATE peca_saldos
           SET saldo_fisico    = saldo_fisico + ${quantidade},
               saldo_em_compra = saldo_em_compra - ${quantidade},
               saldo_reservado = saldo_reservado + ${reservado},
               updated_at = now()
         WHERE peca_id = ${item.pecaId}::uuid
           AND deposito_id = ${oc.depositoId}::uuid
      `);

      const custoUnit = entrada.valorUnit ?? Number(item.valorUnit);
      const peca = await tx.peca.findFirstOrThrow({
        where: { id: item.pecaId, companyId: input.companyId },
        select: { custoMedio: true },
      });
      await tx.peca.update({
        where: { id: item.pecaId },
        data: { custoMedio: novoCustoMedio(Number(peca.custoMedio), saldoAnterior, quantidade, custoUnit) },
      });
      await tx.estoqueMovimento.create({
        data: {
          companyId: input.companyId,
          pecaId: item.pecaId,
          depositoId: oc.depositoId,
          tipo: 'entrada',
          quantidade,
          saldoApos: saldoAnterior + quantidade,
          custoUnit,
          origemTipo: 'recebimento',
          origemId: recebimento.id,
          autorCompanyUserId: input.autorCompanyUserId,
          observacao: oc.numero,
        },
      });

      await tx.ordemCompraItem.update({
        where: { id: item.id },
        data: { quantidadeRecebida: { increment: quantidade } },
      });
      for (const po of distribuicao.porOrigem) {
        await tx.ordemCompraItemOrigem.update({
          where: { id: po.origemId },
          data: { quantidadeRecebida: { increment: po.recebido } },
        });
      }

      for (const r of distribuicao.reservas) {
        const fresco = faltanteFresco.get(r.requisicaoItemId);
        if (!fresco) throw new Error(`Item de requisição ${r.requisicaoItemId} sumiu durante o recebimento.`);
        const cobriuTudo = milesimos(r.quantidade) >= milesimos(faltaAtual[r.requisicaoItemId] ?? 0);
        // Condicionado a ainda estar `faltante`: com a requisição travada nada
        // o muda por baixo, e se mudou o `throw` desfaz o saldo acima.
        const gravado = await tx.requisicaoMaterialItem.updateMany({
          where: { id: r.requisicaoItemId, status: 'faltante' },
          data: {
            quantidadeReservada: { increment: r.quantidade },
            ...(cobriuTudo ? { status: 'reservada' } : {}),
          },
        });
        if (gravado.count === 0) {
          throw new ConflictException('A falta mudou durante o recebimento — tente de novo.');
        }
        requisicoesQueGanharamPeca.add(fresco.requisicaoId);
        if (cobriuTudo) requisicoesComItemCompleto.add(fresco.requisicaoId);
      }
    }

    await tx.recebimentoItem.create({
      data: {
        recebimentoId: recebimento.id,
        ordemCompraItemId: item.id,
        quantidadeRecebida: entrada.quantidadeRecebida,
        quantidadeRecusada: entrada.quantidadeRecusada,
        valorUnit: entrada.valorUnit,
        lote: entrada.lote,
        validade: entrada.validade,
        divergencia: entrada.divergencia?.trim() || null,
      },
    });
  }

  // 7. Requisição `separada` com item que virou `reservada` volta a
  //    `em_separacao`: a peça nova precisa ser conferida, e item `reservada`
  //    não conferido numa requisição `separada` seria cancelado pela entrega
  //    seguinte. Reserva parcial NÃO reabre: o item continua `faltante`, não
  //    há o que conferir, e reabrir travaria a liberação e a entrega do resto
  //    do kit até alguém reconferir nada.
  for (const requisicaoId of [...requisicoesComItemCompleto].sort()) {
    await tx.requisicaoMaterial.updateMany({
      where: { id: requisicaoId, status: 'separada' },
      data: { status: 'em_separacao' },
    });
  }

  // 8. Itens de solicitação recebidos por inteiro viram `atendida`; os
  //    cabeçalhos são recalculados.
  if (itensDeSolicitacaoIds.length) {
    const itensDeSolicitacao = await tx.solicitacaoCompraItem.findMany({
      where: { id: { in: itensDeSolicitacaoIds } },
      select: {
        id: true,
        solicitacaoId: true,
        status: true,
        quantidade: true,
        origensOc: { select: { quantidadeRecebida: true } },
      },
    });
    for (const s of itensDeSolicitacao) {
      const recebido = s.origensOc.reduce((soma, o) => soma + milesimos(Number(o.quantidadeRecebida)), 0);
      if (s.status === 'aberta' && recebido >= milesimos(Number(s.quantidade))) {
        await tx.solicitacaoCompraItem.updateMany({
          where: { id: s.id, status: 'aberta' },
          data: { status: 'atendida' },
        });
      }
    }
    for (const solicitacaoId of [...new Set(itensDeSolicitacao.map((s) => s.solicitacaoId))].sort()) {
      await recalcularEstadoDaSolicitacao(tx, solicitacaoId);
    }
  }

  // 9. Estado da OC — `recebida` só com tudo dentro; recebimento só de recusa
  //    numa OC que ainda não recebeu nada não muda o estado dela.
  const itensDepois = await tx.ordemCompraItem.findMany({
    where: { ordemCompraId: oc.id },
    select: { quantidade: true, quantidadeRecebida: true },
  });
  const algoJaEntrou = itensDepois.some((i) => milesimos(Number(i.quantidadeRecebida)) > 0);
  const statusOrdemCompra = algoJaEntrou
    ? statusDaOrdemAposRecebimento(
        itensDepois.map((i) => ({ quantidade: Number(i.quantidade), quantidadeRecebida: Number(i.quantidadeRecebida) })),
      )
    : oc.status;
  if (statusOrdemCompra !== oc.status) {
    const gravado = await tx.ordemCompra.updateMany({
      where: { id: oc.id, status: oc.status },
      data: { status: statusOrdemCompra },
    });
    if (gravado.count === 0) {
      throw new ConflictException('A ordem de compra mudou durante o recebimento — tente de novo.');
    }
  }

  // 10. Estado da OS de cada requisição que ganhou peça — pela máquina inteira
  //     (os itens mudaram), refinado pela cobertura que sobrou. Por último, na
  //     ordem única de trava.
  //
  //     Só grava numa OS que está num estado de COMPRA. Liberação e entrega
  //     nunca deixam uma OS com item faltante fora deles (a máquina manda
  //     `aguardando_compra`), e a exceção — `em_analise_materiais`, com item
  //     não vinculado — a própria máquina devolve igual. O guard existe para
  //     o que vier por cima: uma OS já em execução não pode ser rebaixada a
  //     `aguardando_separacao` porque chegou a peça de uma falta antiga.
  const notificacoes: NotificacaoPronta[] = [];
  for (const requisicaoId of [...requisicoesQueGanharamPeca].sort()) {
    const req = await tx.requisicaoMaterial.findUniqueOrThrow({
      where: { id: requisicaoId },
      select: {
        numero: true,
        serviceOrderId: true,
        itens: {
          select: {
            id: true, status: true, origem: true, impeditivo: true, quantidadeSolicitada: true, quantidadeReservada: true,
          },
        },
        serviceOrder: {
          select: {
            protocolo: true,
            statusMateriais: true,
            equipmentId: true,
            equipmentNome: true,
            responsavelOperatorId: true,
          },
        },
      },
    });
    const base = statusAposConsulta(req.itens.map((i) => ({ impeditivo: i.impeditivo, status: i.status })));
    const depois = await refinarPelaCompra(tx, base, req.itens);
    const antes = req.serviceOrder.statusMateriais;
    if (!ESTADOS_DE_COMPRA.has(antes)) continue;
    if (depois !== antes) {
      const gravado = await tx.serviceOrder.updateMany({
        where: { id: req.serviceOrderId, companyId: input.companyId },
        data: { statusMateriais: depois },
      });
      if (gravado.count === 0) throw new NotFoundException('OS não encontrada para esta empresa.');
    }
    notificacoes.push(
      ...(await montarNotificacoesDoRecebimento(tx, {
        companyId: input.companyId,
        serviceOrderId: req.serviceOrderId,
        requisicaoId,
        numeroRequisicao: req.numero,
        numeroOrdemCompra: oc.numero,
        protocolo: req.serviceOrder.protocolo,
        equipmentId: req.serviceOrder.equipmentId,
        equipmentNome: req.serviceOrder.equipmentNome,
        responsavelOperatorId: req.serviceOrder.responsavelOperatorId,
        antes,
        depois,
      })),
    );
  }

  // 11. Rastro — parte do ato.
  await registrarAuditoriaSuprimentos(tx, {
    companyId: input.companyId,
    acao: 'recebimento.registrar',
    alvoTipo: 'suprimentos.recebimento',
    alvoId: recebimento.id,
    atorCompanyUserId: input.autorCompanyUserId,
    depois: {
      ordemCompra: oc.numero,
      statusOrdemCompra,
      notaFiscal: input.notaFiscalNumero,
      itens: input.itens.map((i) => ({
        ordemCompraItemId: i.ordemCompraItemId,
        recebida: i.quantidadeRecebida,
        recusada: i.quantidadeRecusada,
        divergencia: i.divergencia,
      })),
    },
  });

  return { resultado: { recebimentoId: recebimento.id, statusOrdemCompra }, notificacoes };
}
