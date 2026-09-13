import { Prisma } from '../../../prisma/generated/client';
import {
  montarLinhas,
  usuariosDoGrupo,
  type NotificacaoPronta,
} from '../notificacoes/almoxarifado-notificacoes';
import type { SolicitacaoAberta } from './solicitacao-de-falta';

function quantidadeLegivel(q: number): string {
  return String(q).replace('.', ',');
}

/**
 * Os avisos de um pedido de peça adicional (§5 da F4). Só MONTA as linhas —
 * quem grava é o chamador, depois do commit, com `enviarNotificacoes`.
 *
 * - Programadores do equipamento: a OS deles ganhou um material fora do
 *   plano e pode voltar a esperar peça.
 * - Almoxarifado: tem peça para separar, ou uma falta para acompanhar.
 * - Compras, só quando nasceu solicitação: ela está na fila deles.
 */
export async function montarNotificacoesDePecaAdicional(
  tx: Prisma.TransactionClient,
  input: {
    companyId: string;
    serviceOrderId: string;
    requisicaoId: string;
    numeroRequisicao: string;
    protocolo: string;
    equipmentId: string | null;
    equipmentNome: string | null;
    descricaoPeca: string;
    quantidade: number;
    reservadaInteira: boolean;
    solicitacao: SolicitacaoAberta | null;
  },
): Promise<NotificacaoPronta[]> {
  const maquina = input.equipmentNome ? ` (${input.equipmentNome})` : '';
  const peca = `${quantidadeLegivel(input.quantidade)} × ${input.descricaoPeca}`;

  // Isolamento por empresa pela relação: `equipment_programadores` não tem
  // `company_id` (mesma consulta dos outros avisos do módulo).
  const programadores = input.equipmentId
    ? (
        await tx.equipmentProgramador.findMany({
          where: { equipmentId: input.equipmentId, equipment: { companyId: input.companyId } },
          select: { companyUserId: true },
        })
      ).map((p) => p.companyUserId)
    : [];
  const almoxarifes = await usuariosDoGrupo(tx, input.companyId, 'almoxarifado');

  const situacao = input.solicitacao
    ? `sem estoque suficiente, a solicitação ${input.solicitacao.numero} foi aberta para Compras`
    : 'reservada no estoque';

  const linhas: NotificacaoPronta[] = [
    ...(await montarLinhas(
      tx,
      input.companyId,
      programadores.map((id) => ({
        destinatarioId: id,
        titulo: `${input.protocolo}: peça adicional pedida`,
        mensagem: `${peca} para a ${input.protocolo}${maquina} — ${situacao}.`,
        referenciaTipo: 'service_order',
        referenciaId: input.serviceOrderId,
      })),
    )),
    ...(await montarLinhas(
      tx,
      input.companyId,
      almoxarifes.map((id) => ({
        destinatarioId: id,
        titulo: `Peça adicional na ${input.numeroRequisicao}`,
        mensagem:
          `${peca} para a ${input.protocolo}${maquina}. ` +
          (input.reservadaInteira ? 'Confira e separe.' : 'Sem estoque suficiente: aguardando compra.'),
        referenciaTipo: 'requisicao_material',
        referenciaId: input.requisicaoId,
      })),
    )),
  ];

  if (input.solicitacao) {
    const critica = input.solicitacao.prioridade === 'critica';
    const compradores = await usuariosDoGrupo(tx, input.companyId, 'compras');
    linhas.push(
      ...(await montarLinhas(
        tx,
        input.companyId,
        compradores.map((id) => ({
          destinatarioId: id,
          titulo: `Solicitação ${input.solicitacao!.numero} ${critica ? 'crítica' : 'urgente'}`,
          mensagem:
            `Peça adicional para a ${input.protocolo}${maquina}: ${peca}` +
            `${critica ? ' — sem ela a máquina não anda' : ''}.`,
          referenciaTipo: 'solicitacao_compra',
          referenciaId: input.solicitacao!.id,
        })),
      )),
    );
  }

  return linhas;
}
