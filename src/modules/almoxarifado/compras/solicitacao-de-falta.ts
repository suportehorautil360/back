import { Prisma } from '../../../prisma/generated/client';
import { proximoNumeroDocumento } from '../helpers/numero-documento.helper';

/** Uma falta de um item de requisição, pronta para virar item de solicitação. */
export interface FaltaParaSolicitar {
  requisicaoItemId: string;
  pecaId: string;
  quantidade: number;
  impeditivo: boolean;
}

export interface SolicitacaoAberta {
  id: string;
  numero: string;
  prioridade: 'critica' | 'alta';
  itens: number;
}

/**
 * Abre a solicitação de compra das faltas de uma requisição, na MESMA
 * transação que criou os itens faltantes. É o critério 2 do §13 ("estoque
 * parcial → reserva o disponível e solicita só a diferença"): a falta e a
 * solicitação nascem juntas, e uma OS nunca fica `aguardando_compra` sem uma
 * solicitação que alguém de Compras veja.
 *
 * Uma SC por chamada, um item por falta, cada item apontando para o item de
 * requisição que ele cobre. O índice único parcial
 * `solicitacao_compra_itens_uma_por_falta` impede uma segunda solicitação viva
 * para a mesma falta (critério 3) — mesmo que duas transações tentem.
 *
 * Prioridade: `critica` para falta de item impeditivo (a máquina não começa
 * sem ela), `alta` para o resto da OS. O cabeçalho leva a mais alta dos itens.
 *
 * O número (`SC-2026-001`) é MAX+1 por empresa: o índice único de
 * `(company_id, numero)` DETECTA a colisão, e quem absorve é o retry de
 * contenção de quem chamou (`erroDeContencaoTransitoria` reconhece o `P2002`
 * de número).
 */
export async function abrirSolicitacaoDasFaltas(
  tx: Prisma.TransactionClient,
  input: {
    companyId: string;
    depositoId: string;
    serviceOrderId: string;
    requisicaoId: string;
    /** Quem abriu a OS (ou pediu a peça). Nulo quando foi o sistema. */
    solicitanteCompanyUserId: string | null;
    origem: 'falta_os' | 'peca_adicional';
    dataNecessidade: Date | null;
    faltas: FaltaParaSolicitar[];
  },
): Promise<SolicitacaoAberta | null> {
  const faltas = input.faltas.filter((f) => Math.round(f.quantidade * 1000) > 0);
  if (faltas.length === 0) return null;

  const ano = new Date().getUTCFullYear();
  const existentes = await tx.solicitacaoCompra.findMany({
    where: { companyId: input.companyId, numero: { startsWith: `SC-${ano}-` } },
    select: { numero: true },
  });
  const numero = proximoNumeroDocumento('SC', ano, existentes.map((e) => e.numero));
  const prioridade = faltas.some((f) => f.impeditivo) ? 'critica' : 'alta';

  const sc = await tx.solicitacaoCompra.create({
    data: {
      companyId: input.companyId,
      numero,
      origem: input.origem,
      prioridade,
      depositoId: input.depositoId,
      serviceOrderId: input.serviceOrderId,
      requisicaoId: input.requisicaoId,
      solicitanteCompanyUserId: input.solicitanteCompanyUserId,
      itens: {
        create: faltas.map((f) => ({
          pecaId: f.pecaId,
          quantidade: f.quantidade,
          requisicaoItemId: f.requisicaoItemId,
          prioridade: f.impeditivo ? 'critica' : 'alta',
          dataNecessidade: input.dataNecessidade,
        })),
      },
    },
    select: { id: true, numero: true },
  });

  return { id: sc.id, numero: sc.numero, prioridade, itens: faltas.length };
}
