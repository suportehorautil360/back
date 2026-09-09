/**
 * Lê o que o observador da fase 2 juntou: quem chama a API sem credencial.
 *
 * É a entrada da fase 3 — com esta lista dá para marcar o que é legítimo,
 * avisar quem precisa mandar token, e só então virar o guard para barrar.
 * Sem ela, fechar a API é apostar na leitura de código, e essa aposta já
 * saiu errada uma vez neste trabalho.
 *
 *   npx tsx scripts/ler-acessos-sem-token.ts
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

(async () => {
  const linhas = await p.apiAcessoSemToken.findMany({
    orderBy: [{ total: 'desc' }, { ultimaEm: 'desc' }],
    take: 100,
  });

  if (linhas.length === 0) {
    console.log(
      'Nenhum acesso sem token registrado ainda.\n' +
        'Ou o observador acabou de subir, ou ninguém chamou rota aberta sem credencial.',
    );
    await p.$disconnect();
    return;
  }

  const total = linhas.reduce((s, l) => s + l.total, 0);
  console.log(`${linhas.length} conjuntos distintos · ${total} requisições sem token\n`);

  const larguraCtrl = Math.max(...linhas.map((l) => l.controller.length));
  for (const l of linhas) {
    const origem = l.origem ?? '—';
    const ua = (l.userAgent ?? '—').slice(0, 40);
    console.log(
      `${String(l.total).padStart(6)}x  ${l.controller.padEnd(larguraCtrl)} ` +
        `${l.metodo} ${l.handler}\n` +
        `${' '.repeat(9)}origem=${origem}\n` +
        `${' '.repeat(9)}agente=${ua}\n` +
        `${' '.repeat(9)}de ${l.primeiraEm.toISOString()} até ${l.ultimaEm.toISOString()}\n`,
    );
  }

  console.log('\nPor controller:');
  const porController = new Map<string, number>();
  for (const l of linhas) {
    porController.set(l.controller, (porController.get(l.controller) ?? 0) + l.total);
  }
  for (const [c, n] of [...porController].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(n).padStart(6)}x  ${c}`);
  }

  await p.$disconnect();
})().catch((e) => {
  console.error('ERRO:', e.message);
  process.exit(1);
});
