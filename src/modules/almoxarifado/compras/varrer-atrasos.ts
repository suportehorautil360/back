import { Logger } from '@nestjs/common';
import type { PrismaClient } from '../../../prisma/generated/client';
import { ordensAtrasadas } from './atraso';
import { usuariosDoGrupo } from '../notificacoes/almoxarifado-notificacoes';

/**
 * Critério 12: a varredura que avisa sobre ordem de compra atrasada, com a
 * lista de OS que estão esperando por ela.
 *
 * As OS impactadas saem pelo caminho que a decisão D5 abriu de propósito:
 * `OrdemCompraItemOrigem` → `SolicitacaoCompraItem` → `requisicaoItem` →
 * `requisicao` → `serviceOrder`. O vínculo foi feito no ITEM, e não no
 * cabeçalho, justamente para não se perder na agregação.
 *
 * Uma empresa que falha conta uma falha e não impede as outras — mesma postura
 * de `varrerEstoqueMinimo`.
 */

const FEATURE_SUPRIMENTOS = 'suprimentos';
const logger = new Logger('VarrerAtrasos');

/** O grupo que age quando o fornecedor fura o prazo: quem compra e quem recebe. */
const GRUPOS: Array<'compras' | 'almoxarifado'> = ['compras', 'almoxarifado'];

export interface ResumoDaVarredura {
  empresas: number;
  atrasadas: number;
  avisos: number;
  falhas: number;
}

function comparar(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** "3 dias" / "1 dia" — sem plural errado no aviso que a pessoa lê. */
function emDias(n: number): string {
  return n === 1 ? '1 dia' : `${n} dias`;
}

export async function varrerAtrasos(
  prisma: PrismaClient,
  hoje: Date = new Date(),
): Promise<ResumoDaVarredura> {
  const ligadas = await prisma.companyFeature.findMany({
    where: { enabled: true, feature: { key: FEATURE_SUPRIMENTOS } },
    select: { companyId: true },
  });
  const empresas = [...new Set(ligadas.map((l) => l.companyId))].sort(comparar);

  const resumo: ResumoDaVarredura = {
    empresas: empresas.length,
    atrasadas: 0,
    avisos: 0,
    falhas: 0,
  };

  for (const companyId of empresas) {
    try {
      const ordens = await prisma.ordemCompra.findMany({
        where: {
          companyId,
          previsaoEntrega: { not: null },
          status: { in: ['emitida', 'enviada', 'recebida_parcial'] },
        },
        select: {
          id: true,
          numero: true,
          status: true,
          previsaoEntrega: true,
          itens: {
            select: {
              origens: {
                select: {
                  solicitacaoCompraItem: {
                    select: {
                      requisicaoItem: {
                        select: {
                          requisicao: {
                            select: { serviceOrder: { select: { id: true, protocolo: true } } },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      });

      const atrasadas = ordensAtrasadas(ordens, hoje);
      resumo.atrasadas += atrasadas.length;
      if (atrasadas.length === 0) continue;

      // Reusa `usuariosDoGrupo`: a consulta é em DUAS etapas porque o espelho
      // do back não declara a relação `companyRole` em `Operator` — reinventá-la
      // aqui não compila, como esta varredura descobriu na primeira tentativa.
      const porGrupo = await Promise.all(
        GRUPOS.map((g) => usuariosDoGrupo(prisma, companyId, g)),
      );
      const destinatarios = [...new Set(porGrupo.flat())].sort(comparar);
      if (destinatarios.length === 0) continue;

      const company = await prisma.company.findUnique({
        where: { id: companyId },
        select: { legacyId: true },
      });

      const linhas = atrasadas.flatMap((oc) => {
        // A MESMA OS citada por duas linhas da ordem aparece uma vez só.
        const protocolos = [
          ...new Set(
            oc.itens
              .flatMap((i) => i.origens)
              .map((o) => o.solicitacaoCompraItem?.requisicaoItem?.requisicao?.serviceOrder?.protocolo)
              .filter((p): p is string => Boolean(p)),
          ),
        ].sort(comparar);

        const mensagem =
          protocolos.length > 0
            ? `${oc.numero} está ${emDias(oc.diasDeAtraso)} atrasada. Esperando por ela: ${protocolos.join(', ')}.`
            : `${oc.numero} está ${emDias(oc.diasDeAtraso)} atrasada.`;

        return destinatarios.map((destinatarioId) => ({
          companyId,
          destinatarioTipo: 'company_user',
          destinatarioId,
          prefeituraLegacyId: company?.legacyId ?? companyId,
          titulo: `Ordem de compra atrasada — ${oc.numero}`,
          mensagem,
          tipo: 'info',
          referenciaTipo: 'ordem_compra',
          referenciaId: oc.id,
        }));
      });

      if (linhas.length > 0) {
        await prisma.notificacao.createMany({ data: linhas });
        resumo.avisos += linhas.length;
      }
    } catch (erro) {
      resumo.falhas += 1;
      logger.error(
        `Varredura de atraso falhou na empresa ${companyId}: ${erro instanceof Error ? erro.message : String(erro)}`,
        erro instanceof Error ? erro.stack : undefined,
      );
    }
  }

  return resumo;
}
