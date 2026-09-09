/**
 * Liga um mecânico ao app, depois que a conta dele já existe no Supabase.
 *
 *   npx tsx scripts/habilitar-mecanico.ts mecanico@vrental.com.br
 *
 * O QUE ELE FAZ, e por que cada parte é necessária:
 *
 * 1. Acha o usuário no Supabase Auth pelo e-mail. NÃO cria conta — criar conta
 *    e definir senha é coisa de quem opera o sistema, no painel do Supabase.
 * 2. Cria o `CompanyUser` com o MESMO id do Supabase. Esse id é a chave que o
 *    `PainelGuard` procura ao validar o token, e é o que vai nas colunas de
 *    auditoria da Mecânica (`lancado_por_id`, `enviada_por_id`, `autor_id`).
 * 3. Aponta o `Operator` do mecânico para esse `CompanyUser`. Sem isso o
 *    `/mecanica/eu` devolve `operatorId: null` e o app recusa a entrada, porque
 *    quem não é funcionário não pode apontar hora.
 * 4. Vincula o cargo `mecanico`. Sem `companyRoleId` o `cargoLiberaGrupo` nega
 *    e o módulo responde "Cargo não libera este módulo" — no painel e no app.
 *
 * Idempotente: rodar de novo não duplica nada e diz o que já estava certo.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/prisma/generated/client';

/** Empresa alvo. Trocar aqui para habilitar mecânico de outra. */
const EMPRESA = 'VRENTAL';

function env(chave: string): string {
  const arquivo = readFileSync(resolve(__dirname, '../.env'), 'utf8');
  const linha = arquivo.split('\n').find((l) => l.startsWith(`${chave}=`));
  if (!linha) throw new Error(`${chave} não está no .env do back.`);
  return linha
    .slice(chave.length + 1)
    .trim()
    .replace(/^["']|["']$/g, '');
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: env('DATABASE_URL') }),
});

interface UsuarioSupabase {
  id: string;
  email?: string;
  user_metadata?: { name?: string; full_name?: string };
}

/**
 * Procura o usuário no Supabase Auth. Usa a chave de serviço porque a listagem
 * de usuários é rota de admin — por isso este script roda na sua máquina, com
 * o `.env` do back, e nunca no navegador.
 */
async function acharNoSupabase(email: string): Promise<UsuarioSupabase> {
  const base = env('SUPABASE_URL').replace(/\/$/, '');
  const chave = env('SUPABASE_SECRET_KEY');

  const resposta = await fetch(
    `${base}/auth/v1/admin/users?filter=${encodeURIComponent(email)}`,
    { headers: { apikey: chave, Authorization: `Bearer ${chave}` } },
  );
  if (!resposta.ok) {
    throw new Error(
      `Supabase respondeu ${resposta.status}. Confira SUPABASE_SECRET_KEY no .env.`,
    );
  }

  const corpo = (await resposta.json()) as { users?: UsuarioSupabase[] };
  const alvo = (corpo.users ?? []).find(
    (u) => u.email?.toLowerCase() === email.toLowerCase(),
  );
  if (!alvo) {
    throw new Error(
      `Não achei "${email}" no Supabase Auth.\n` +
        'Crie a conta primeiro: painel do Supabase → Authentication → Add user.',
    );
  }
  return alvo;
}

(async () => {
  const email = process.argv[2]?.trim();
  if (!email) {
    console.error('Uso: npx tsx scripts/habilitar-mecanico.ts <e-mail do mecânico>');
    process.exit(1);
  }

  const usuario = await acharNoSupabase(email);
  console.log(`Supabase: ${email} → ${usuario.id}`);

  const empresa = await prisma.company.findFirst({
    where: { name: { contains: EMPRESA } },
    select: { id: true, name: true },
  });
  if (!empresa) throw new Error(`Empresa "${EMPRESA}" não encontrada.`);

  const cargo = await prisma.companyRole.findFirst({
    where: { companyId: empresa.id, key: 'mecanico' },
    select: { id: true, label: true },
  });
  if (!cargo) throw new Error('Cargo `mecanico` não existe nesta empresa.');

  // Qual funcionário é este mecânico. Sem `Operator` não há quem execute a OS.
  const operador = await prisma.operator.findFirst({
    where: {
      companyId: empresa.id,
      OR: [
        { cargo: { contains: 'ecânic', mode: 'insensitive' } },
        { funcao: { contains: 'ecânic', mode: 'insensitive' } },
      ],
    },
    select: { id: true, nome: true, companyUserId: true, companyRoleId: true },
  });
  if (!operador) {
    throw new Error(
      `Nenhum funcionário com cargo de mecânico em ${empresa.name}. ` +
        'Cadastre-o em Pessoas → Funcionários antes de rodar isto.',
    );
  }
  console.log(`Funcionário: ${operador.nome}`);

  const nome =
    usuario.user_metadata?.name ?? usuario.user_metadata?.full_name ?? operador.nome;

  await prisma.companyUser.upsert({
    where: { id: usuario.id },
    create: {
      id: usuario.id,
      companyId: empresa.id,
      email,
      name: nome,
      role: 'MEMBER',
    },
    update: { companyId: empresa.id, email, name: nome },
  });
  console.log('CompanyUser: pronto');

  await prisma.operator.update({
    where: { id: operador.id },
    data: { companyUserId: usuario.id, companyRoleId: cargo.id },
  });
  console.log(`Funcionário vinculado à conta e ao cargo ${cargo.label}`);

  console.log(
    `\nPronto. ${operador.nome} entra no app com ${email}.\n` +
      'Falta só publicar o app com NEXT_PUBLIC_APP_ENV=producao.',
  );
  await prisma.$disconnect();
})().catch((e: unknown) => {
  console.error(`\nERRO: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
