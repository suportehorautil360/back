import { Prisma } from '../../../prisma/generated/client';
import {
  montarLinhas,
  usuariosDoGrupo,
  type NotificacaoPronta,
} from '../notificacoes/almoxarifado-notificacoes';
import type { StatusMateriais } from '../regras/status-materiais';

/**
 * Os avisos que um recebimento gera para UMA OS (§9: "recebimento parcial" e
 * a peça que destrava a OS). Só MONTA as linhas — quem grava é o chamador,
 * depois do commit, com `enviarNotificacoes`.
 *
 * Avisa por TRANSIÇÃO do `statusMateriais`, nunca por estado: um segundo
 * recebimento que deixa a OS no mesmo estado não repete o aviso.
 *
 * - Passou a `recebimento_parcial`: programadores do equipamento e o
 *   almoxarifado — chegou parte, ainda não dá para separar tudo.
 * - Saiu de um estado de compra para `aguardando_separacao` (a última falta
 *   foi coberta): o almoxarifado confere e separa; mecânico responsável e
 *   programadores sabem que a peça chegou e que falta a liberação.
 */
export async function montarNotificacoesDoRecebimento(
  tx: Prisma.TransactionClient,
  input: {
    companyId: string;
    serviceOrderId: string;
    requisicaoId: string;
    numeroRequisicao: string;
    numeroOrdemCompra: string;
    protocolo: string;
    equipmentId: string | null;
    equipmentNome: string | null;
    responsavelOperatorId: string | null;
    antes: string;
    depois: StatusMateriais;
  },
): Promise<NotificacaoPronta[]> {
  const ESTADOS_DE_COMPRA = new Set(['aguardando_compra', 'compra_em_andamento', 'recebimento_parcial']);
  const parcialAgora = input.depois === 'recebimento_parcial' && input.antes !== 'recebimento_parcial';
  const destravou = input.depois === 'aguardando_separacao' && ESTADOS_DE_COMPRA.has(input.antes);
  if (!parcialAgora && !destravou) return [];

  const maquina = input.equipmentNome ? ` (${input.equipmentNome})` : '';
  const programadores = input.equipmentId
    ? (
        await tx.equipmentProgramador.findMany({
          where: { equipmentId: input.equipmentId, equipment: { companyId: input.companyId } },
          select: { companyUserId: true },
        })
      ).map((p) => p.companyUserId)
    : [];
  const almoxarifes = await usuariosDoGrupo(tx, input.companyId, 'almoxarifado');

  if (parcialAgora) {
    const paraBancada = await montarLinhas(
      tx,
      input.companyId,
      programadores.map((id) => ({
        destinatarioId: id,
        titulo: `${input.protocolo}: chegou parte das peças`,
        mensagem: `A ${input.numeroOrdemCompra} entregou parte do que a ${input.protocolo}${maquina} espera. Ainda falta peça para liberar.`,
        referenciaTipo: 'service_order',
        referenciaId: input.serviceOrderId,
      })),
    );
    const paraAlmoxarifado = await montarLinhas(
      tx,
      input.companyId,
      almoxarifes.map((id) => ({
        destinatarioId: id,
        titulo: `${input.numeroRequisicao}: chegou parte das peças`,
        mensagem: `A ${input.numeroOrdemCompra} entregou parte do que a ${input.protocolo}${maquina} espera. A reserva foi feita; o kit ainda não fecha.`,
        referenciaTipo: 'requisicao_material',
        referenciaId: input.requisicaoId,
      })),
    );
    return [...paraBancada, ...paraAlmoxarifado];
  }

  const bancada = [...programadores];
  if (input.responsavelOperatorId) {
    const mecanico = await tx.operator.findFirst({
      where: { id: input.responsavelOperatorId, companyId: input.companyId },
      select: { companyUserId: true },
    });
    if (mecanico?.companyUserId) bancada.push(mecanico.companyUserId);
  }
  const paraBancada = await montarLinhas(
    tx,
    input.companyId,
    bancada.map((id) => ({
      destinatarioId: id,
      titulo: `${input.protocolo}: peça chegou`,
      mensagem: `A peça que faltava para a ${input.protocolo}${maquina} chegou (${input.numeroOrdemCompra}). O almoxarifado vai conferir o kit — aguarde a liberação.`,
      referenciaTipo: 'service_order',
      referenciaId: input.serviceOrderId,
    })),
  );
  const paraAlmoxarifado = await montarLinhas(
    tx,
    input.companyId,
    almoxarifes.map((id) => ({
      destinatarioId: id,
      titulo: `Kit da ${input.numeroRequisicao} a conferir`,
      mensagem: `Chegou a peça que faltava para a ${input.protocolo}${maquina} (${input.numeroOrdemCompra}). Confira e separe o kit.`,
      referenciaTipo: 'requisicao_material',
      referenciaId: input.requisicaoId,
    })),
  );
  return [...paraBancada, ...paraAlmoxarifado];
}
