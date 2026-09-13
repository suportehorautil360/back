/**
 * Roda a varredura de estoque mínimo (o mesmo caminho do cron das 7h) uma vez,
 * contra o banco do `.env`. Usa o MOTOR de produção — a solicitação nasce com
 * número, prioridade, "em nome de" e rastro como nasceria sozinha.
 *
 * Uso: npx tsx --env-file=.env scripts/varrer-estoque-minimo.ts
 */
import { PrismaService } from '../src/prisma/prisma.service';
import { varrerEstoqueMinimo } from '../src/modules/almoxarifado/compras/estoque-minimo';

async function main(): Promise<void> {
  // O mesmo cliente da aplicação: adapter, log e o timeout de transação que o
  // `PrismaService` configura — rodar com um cliente diferente daria resultado
  // diferente do que a rota dá.
  const prisma = new PrismaService();
  try {
    console.log(await varrerEstoqueMinimo(prisma));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
