import { NotFoundException } from '@nestjs/common';
import { Prisma } from '../../prisma/generated/client';

/**
 * O rastro de Suprimentos (decisão D8 do desenho): reusa `ponto_auditoria`, que
 * já é append-only por gatilho (`ponto_auditoria_append_only` barra UPDATE e
 * DELETE; `ponto_auditoria_sem_truncate` barra TRUNCATE), congela o ator e tem
 * antes/depois e motivo. O RH já a reusa com `alvo_tipo = 'solicitacoes_rh'`;
 * aqui o `alvoTipo` sempre começa com `suprimentos.`.
 *
 * Ao contrário da notificação, o rastro É PARTE DO ATO: grava com o `tx` da
 * transação de negócio e pode lançar — se o rastro não grava, o ato dá
 * rollback junto. Mesmo contrato de `registrarAuditoria`
 * (`horautil/lib/company/ponto/auditoria.ts`), o outro escritor da tabela.
 */
export type AlvoSuprimentos =
  | 'suprimentos.ordem_compra'
  | 'suprimentos.solicitacao_compra'
  | 'suprimentos.recebimento'
  | 'suprimentos.requisicao'
  | 'suprimentos.inventario';

export async function registrarAuditoriaSuprimentos(
  tx: Prisma.TransactionClient,
  entrada: {
    companyId: string;
    /** Ex.: "ordem_compra.emitir", "ordem_compra.aprovar", "recebimento.registrar". */
    acao: string;
    alvoTipo: AlvoSuprimentos;
    alvoId: string;
    /** Nulo quando o ato foi do sistema (ex.: solicitação automática). */
    atorCompanyUserId: string | null;
    motivo?: string | null;
    antes?: Prisma.InputJsonValue;
    depois?: Prisma.InputJsonValue;
  },
): Promise<void> {
  // Nome e e-mail congelados no instante do ato: o rastro sobrevive à remoção
  // ou à renomeação do usuário. O `companyId` no `where` garante que um id de
  // usuário de OUTRA empresa não assina ato nenhum aqui.
  let atorNome = 'Sistema';
  let atorEmail = '';
  if (entrada.atorCompanyUserId) {
    const ator = await tx.companyUser.findFirst({
      where: { id: entrada.atorCompanyUserId, companyId: entrada.companyId },
      select: { name: true, email: true },
    });
    if (!ator) throw new NotFoundException('Usuário do painel não encontrado nesta empresa.');
    atorNome = ator.name;
    atorEmail = ator.email;
  }

  await tx.pontoAuditoria.create({
    data: {
      companyId: entrada.companyId,
      acao: entrada.acao,
      alvoTipo: entrada.alvoTipo,
      alvoId: entrada.alvoId,
      atorId: entrada.atorCompanyUserId,
      atorNome,
      atorEmail,
      motivo: entrada.motivo ?? null,
      // Chave ausente em vez de `null`: Json? nulável no Prisma exige
      // `Prisma.DbNull` para gravar NULL, e "não se aplica" é a ausência.
      ...(entrada.antes !== undefined ? { antes: entrada.antes } : {}),
      ...(entrada.depois !== undefined ? { depois: entrada.depois } : {}),
    },
  });
}
