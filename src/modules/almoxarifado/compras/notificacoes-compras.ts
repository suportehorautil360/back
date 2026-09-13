import { Prisma } from '../../../prisma/generated/client';
import {
  aprovadoresDeCompra,
  montarLinhas,
  type NotificacaoPronta,
} from '../notificacoes/almoxarifado-notificacoes';

/**
 * Os avisos do ciclo da ordem de compra. Mesmo contrato do resto do módulo:
 * estas funções só MONTAM as linhas, com o `tx` da transação do ato (é onde o
 * estado é confiável); quem grava é o serviço, depois do commit e fora do laço
 * de retry, com `enviarNotificacoes(this.prisma, linhas)`.
 */

function emReais(valor: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(valor);
}

/**
 * Ordem confirmada acima do limite (ou sem limite configurado): quem pode
 * aprovar precisa saber que há compra parada esperando por ele. Destinatários
 * são os de `aprovadoresDeCompra` — OWNER/ADMIN ativos e o gestor master.
 */
export async function montarNotificacaoAguardandoAprovacao(
  tx: Prisma.TransactionClient,
  input: {
    companyId: string;
    ordemCompraId: string;
    numero: string;
    fornecedor: string;
    valorTotal: number;
    limite: number | null;
    gestorMasterCompanyUserId: string | null;
  },
): Promise<NotificacaoPronta[]> {
  const aprovadores = await aprovadoresDeCompra(tx, input.companyId, input.gestorMasterCompanyUserId);
  const porque =
    input.limite === null
      ? 'a empresa não tem limite de aprovação configurado'
      : `passa do limite de ${emReais(input.limite)}`;
  return montarLinhas(
    tx,
    input.companyId,
    aprovadores.map((id) => ({
      destinatarioId: id,
      titulo: `${input.numero} aguardando aprovação`,
      mensagem:
        `A ordem de compra ${input.numero} (${input.fornecedor}) soma ${emReais(input.valorTotal)} ` +
        `e ${porque}. Aprove para emitir, ou devolva com o motivo.`,
      referenciaTipo: 'ordem_compra',
      referenciaId: input.ordemCompraId,
    })),
  );
}

/** Ordem devolvida: quem montou a cotação é quem tem de ajustá-la. */
export async function montarNotificacaoOrdemDevolvida(
  tx: Prisma.TransactionClient,
  input: {
    companyId: string;
    ordemCompraId: string;
    numero: string;
    motivo: string;
    criadaPorCompanyUserId: string;
  },
): Promise<NotificacaoPronta[]> {
  return montarLinhas(tx, input.companyId, [
    {
      destinatarioId: input.criadaPorCompanyUserId,
      titulo: `${input.numero} devolvida`,
      mensagem: `A ordem de compra ${input.numero} voltou para rascunho: ${input.motivo}`,
      referenciaTipo: 'ordem_compra',
      referenciaId: input.ordemCompraId,
    },
  ]);
}
