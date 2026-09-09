import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/prisma/generated/client';

const env = readFileSync(resolve(__dirname, '../.env'), 'utf8');
const linha = env.split('\n').find((l) => l.startsWith('DATABASE_URL='));
const connectionString = linha!.slice('DATABASE_URL='.length).trim().replace(/^["']|["']$/g, '');

const p = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
(async () => {
  const total = await p.operator.count();
  const comUser = await p.operator.count({ where: { NOT: { companyUserId: null } } });
  console.log('Operators total:', total, '| com conta de painel:', comUser);
  const mec = await p.operator.findMany({
    where: { OR: [{ cargo: { contains: 'ecânic', mode: 'insensitive' } }, { funcao: { contains: 'ecânic', mode: 'insensitive' } }] },
    select: { nome: true, cargo: true, companyUserId: true, companyRoleId: true, company: { select: { name: true } } },
    take: 20,
  });
  console.log('Mecânicos:', mec.length);
  for (const m of mec) {
    console.log(` - ${m.nome} (${m.company.name}) painel=${m.companyUserId ? 'SIM' : 'NÃO'} cargo=${m.companyRoleId ? 'sim' : 'NÃO'}`);
  }
  await p.$disconnect();
})().catch((e) => { console.error('ERRO:', e.message); process.exit(1); });
