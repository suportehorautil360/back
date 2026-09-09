/**
 * Vincula o Operator do mecânico ao CompanyRole `mecanico` da empresa.
 *
 * POR QUE: sem `companyRoleId`, o `cargoLiberaGrupo` do `PainelGuard` nega e o
 * módulo Mecânica responde "Cargo não libera este módulo" — no painel e no app.
 * O texto livre em `Operator.cargo` NÃO é lido pelo guard: quem manda é a
 * matriz cargo × grupo de acesso.
 *
 * O QUE ISTO NÃO FAZ: não cria conta. Sem `companyUserId` (o `auth.users.id`
 * do Supabase) o usuário nem autentica, então isto sozinho não concede acesso
 * a ninguém — é a metade do cadastro que não exige criar conta.
 *
 * Idempotente: só toca em quem está com `companyRoleId` nulo.
 *
 *   npx tsx scripts/vincular-cargo-mecanico.ts
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/prisma/generated/client';

const env = readFileSync(resolve(__dirname, '../.env'), 'utf8');
const linha = env.split('\n').find((l) => l.startsWith('DATABASE_URL='))!;
const connectionString = linha
  .slice('DATABASE_URL='.length)
  .trim()
  .replace(/^["']|["']$/g, '');
const p = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

/** Empresa alvo. Trocar aqui para rodar em outra. */
const EMPRESA = 'VRENTAL';

(async () => {
  const empresa = await p.company.findFirst({
    where: { name: { contains: EMPRESA } },
    select: { id: true, name: true },
  });
  if (!empresa) throw new Error(`Empresa "${EMPRESA}" não encontrada.`);

  const cargo = await p.companyRole.findFirst({
    where: { companyId: empresa.id, key: 'mecanico' },
    select: { id: true, label: true },
  });
  if (!cargo) throw new Error('Cargo `mecanico` não existe nesta empresa.');

  const alvos = await p.operator.findMany({
    where: {
      companyId: empresa.id,
      companyRoleId: null,
      OR: [
        { cargo: { contains: 'ecânic', mode: 'insensitive' } },
        { funcao: { contains: 'ecânic', mode: 'insensitive' } },
      ],
    },
    select: { id: true, nome: true },
  });

  if (alvos.length === 0) {
    console.log('Nada a fazer: todo mecânico já tem cargo vinculado.');
    await p.$disconnect();
    return;
  }

  for (const a of alvos) {
    await p.operator.update({
      where: { id: a.id },
      data: { companyRoleId: cargo.id },
    });
    console.log(`vinculado: ${a.nome} -> ${cargo.label}`);
  }

  console.log(
    '\nFalta a outra metade: criar o CompanyUser (conta Supabase) e apontar ' +
      'Operator.companyUserId para ele. Sem isso o mecânico não autentica.',
  );
  await p.$disconnect();
})().catch((e) => {
  console.error('ERRO:', e.message);
  process.exit(1);
});
