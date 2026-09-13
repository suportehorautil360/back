/**
 * Reprocessa a reserva de OS preventivas que ficaram em análise de materiais.
 *
 * A OS guarda `categoria_plano_id` e `ciclo_id`, então dá para refazer a
 * consulta de estoque sem pedir nada a ninguém. Usa o SERVIÇO de produção — a
 * requisição, a falta, a solicitação de compra e os avisos saem como sairiam
 * na abertura da OS.
 *
 * Só toca OS `em_analise_materiais`, de execução interna, com categoria e
 * ciclo gravados e SEM requisição viva (a checagem do próprio serviço recusa
 * a segunda reserva, mas filtrar antes evita barulho).
 *
 * Sem argumento, apenas LISTA. Para gravar: `--aplicar`.
 *
 * Uso: npx tsx --env-file=.env scripts/reprocessar-reserva.ts [--aplicar]
 */
import { PrismaService } from '../src/prisma/prisma.service';
import { AlmoxarifadoService } from '../src/modules/almoxarifado/almoxarifado.service';

async function main(): Promise<void> {
  const aplicar = process.argv.includes('--aplicar');
  // O mesmo cliente da aplicação: adapter, log e o timeout de transação que o
  // `PrismaService` configura — rodar com um cliente diferente daria resultado
  // diferente do que a rota dá.
  const prisma = new PrismaService();
  const servico = new AlmoxarifadoService(prisma as never);

  try {
    const candidatas = await prisma.serviceOrder.findMany({
      where: {
        statusMateriais: 'em_analise_materiais',
        execucao: 'interna',
        categoriaPlanoId: { not: null },
        cicloId: { not: null },
        requisicoes: { none: { status: { not: 'cancelada' } } },
      },
      select: {
        id: true, companyId: true, protocolo: true, categoriaPlanoId: true, cicloId: true,
        responsavelOperatorId: true, equipmentNome: true,
      },
      orderBy: { createdAt: 'asc' },
    });

    console.log(`${candidatas.length} OS em análise de materiais para reprocessar${aplicar ? '' : ' (apenas listando)'}`);
    for (const os of candidatas) {
      console.log(`  ${os.protocolo} · ${os.equipmentNome ?? 'sem equipamento'} · ciclo ${os.cicloId}`);
    }
    if (!aplicar || candidatas.length === 0) return;

    for (const os of candidatas) {
      // O depósito é o mesmo que a abertura usaria: o ativo mais antigo da
      // empresa (`depositoPadrao` do painel).
      const deposito = await prisma.deposito.findFirst({
        where: { companyId: os.companyId, ativo: true },
        orderBy: { createdAt: 'asc' },
        select: { id: true },
      });
      if (!deposito) {
        console.error(`  ${os.protocolo}: empresa sem depósito ativo — pulada`);
        continue;
      }
      // Autor: o dono da conta, como "quem reprocessou". A reserva grava o
      // autor na requisição e no razão, e inventar um usuário seria pior.
      const autor = await prisma.companyUser.findFirst({
        where: { companyId: os.companyId, role: 'OWNER', status: 'ACTIVE' },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        select: { id: true },
      });
      if (!autor) {
        console.error(`  ${os.protocolo}: empresa sem OWNER ativo — pulada`);
        continue;
      }

      try {
        const r = await servico.reservarParaOs({
          companyId: os.companyId,
          serviceOrderId: os.id,
          depositoId: deposito.id,
          autorCompanyUserId: autor.id,
          categoriaPlanoId: os.categoriaPlanoId as string,
          cicloId: os.cicloId as string,
        });
        const faltas = r.itens.filter((i) => i.status === 'faltante').length;
        console.log(
          `  ${os.protocolo}: ${r.numero ?? 'sem requisição'} · ${r.itens.length} itens · ` +
            `${faltas} em falta · OS ${r.statusMateriais}`,
        );
      } catch (err) {
        console.error(`  ${os.protocolo}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
