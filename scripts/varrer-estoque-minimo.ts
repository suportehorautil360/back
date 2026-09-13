/**
 * Roda a varredura de estoque mínimo (o mesmo caminho do cron das 7h) uma vez,
 * contra o banco do `.env`. Usa o MOTOR de produção — a solicitação nasce com
 * número, prioridade, "em nome de" e rastro como nasceria sozinha.
 *
 * Uso: npx tsx --env-file=.env scripts/varrer-estoque-minimo.ts
 */
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/prisma/generated/client';
import { varrerEstoqueMinimo } from '../src/modules/almoxarifado/compras/estoque-minimo';

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL não configurada.');
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
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
