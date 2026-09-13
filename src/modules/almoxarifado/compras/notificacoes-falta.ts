import { Prisma } from '../../../prisma/generated/client';
import {
  montarLinhas,
  usuariosDoGrupo,
  type NotificacaoPronta,
} from '../notificacoes/almoxarifado-notificacoes';
import type { SolicitacaoAberta } from './solicitacao-de-falta';

/**
 * Os avisos de uma falta de material que virou solicitação de compra (§9:
 * "OS bloqueada por falta" e "SC crítica criada"). Só MONTA as linhas, com o
 * `tx` da transação que abriu a solicitação — quem grava é o chamador, depois
 * do commit, com `enviarNotificacoes`.
 *
 * - Programadores do equipamento: a OS deles não vai para a bancada até a
 *   peça chegar, e eles precisam saber por quê e qual solicitação cobrar.
 * - Quem tem o grupo Compras: a solicitação está na fila deles, e a
 *   prioridade diz se tem máquina parada esperando.
 */
export async function montarNotificacoesDeFalta(
  tx: Prisma.TransactionClient,
  input: {
    companyId: string;
    serviceOrderId: string;
    protocolo: string;
    equipmentId: string | null;
    equipmentNome: string | null;
    solicitacao: SolicitacaoAberta;
  },
): Promise<NotificacaoPronta[]> {
  // Isolamento por empresa pela relação: `equipment_programadores` não tem
  // `company_id` (mesma consulta de `montarNotificacaoOsLiberada`).
  const programadores = input.equipmentId
    ? await tx.equipmentProgramador.findMany({
        where: { equipmentId: input.equipmentId, equipment: { companyId: input.companyId } },
        select: { companyUserId: true },
      })
    : [];
  const compradores = await usuariosDoGrupo(tx, input.companyId, 'compras');

  const maquina = input.equipmentNome ? ` (${input.equipmentNome})` : '';
  const quantas = input.solicitacao.itens === 1 ? '1 peça' : `${input.solicitacao.itens} peças`;
  const critica = input.solicitacao.prioridade === 'critica';

  const paraProgramadores = await montarLinhas(
    tx,
    input.companyId,
    programadores.map((p) => ({
      destinatarioId: p.companyUserId,
      titulo: `${input.protocolo} aguardando compra`,
      mensagem:
        `${input.solicitacao.itens === 1 ? 'Falta' : 'Faltam'} ${quantas} para a ${input.protocolo}${maquina}. ` +
        `A solicitação ${input.solicitacao.numero} foi aberta para Compras.`,
      referenciaTipo: 'service_order',
      referenciaId: input.serviceOrderId,
    })),
  );

  const paraCompras = await montarLinhas(
    tx,
    input.companyId,
    compradores.map((id) => ({
      destinatarioId: id,
      titulo: `Solicitação ${input.solicitacao.numero} ${critica ? 'crítica' : 'urgente'}`,
      mensagem:
        `${quantas} para a ${input.protocolo}${maquina}` +
        `${critica ? ' — sem ela a máquina não começa' : ''}.`,
      referenciaTipo: 'solicitacao_compra',
      referenciaId: input.solicitacao.id,
    })),
  );

  return [...paraProgramadores, ...paraCompras];
}
