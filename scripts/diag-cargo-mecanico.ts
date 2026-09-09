import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/prisma/generated/client';

const env = readFileSync(resolve(__dirname, '../.env'), 'utf8');
const linha = env.split('\n').find((l) => l.startsWith('DATABASE_URL='))!;
const connectionString = linha.slice('DATABASE_URL='.length).trim().replace(/^["']|["']$/g, '');
const p = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

(async () => {
  const empresa = await p.company.findFirst({ where: { name: { contains: 'VRENTAL' } }, select: { id: true, name: true, slug: true } });
  console.log('Empresa:', empresa);
  if (!empresa) return;

  const cargos = await p.companyRole.findMany({ where: { companyId: empresa.id }, select: { id: true, key: true, label: true, ativo: true } });
  console.log('Cargos da empresa:', cargos);

  const ops = await p.operator.findMany({
    where: { companyId: empresa.id },
    select: { id: true, nome: true, cargo: true, companyRoleId: true, companyUserId: true },
  });
  console.log('Operators:');
  for (const o of ops) console.log(`  ${o.nome} | cargo="${o.cargo ?? '—'}" | companyRoleId=${o.companyRoleId ?? 'NULO'} | companyUserId=${o.companyUserId ?? 'NULO'}`);
  await p.$disconnect();
})().catch((e) => { console.error('ERRO:', e.message); process.exit(1); });
