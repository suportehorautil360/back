// Cria um usuário admin na coleção `users` do Firestore (schema minimalista
// dos admins existentes: id, usuario, senha, type).
//
// Uso:
//   ADMIN_USUARIO=vinicius ADMIN_SENHA='<senha>' node back/scripts/create-admin-user.mjs
//
// Segurança:
//   - Recusa se já existir user com o mesmo `usuario`.
//   - Faz DRY-RUN por padrão. Passe --commit pra escrever de verdade.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import admin from 'firebase-admin';

const here = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(here, '..', '.env');
const env = Object.fromEntries(
  readFileSync(envPath, 'utf8')
    .split('\n')
    .filter((l) => l && !l.trim().startsWith('#') && l.includes('='))
    .map((l) => {
      const i = l.indexOf('=');
      let v = l.slice(i + 1).trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1);
      }
      return [l.slice(0, i).trim(), v];
    }),
);

const usuario = (process.env.ADMIN_USUARIO || '').trim();
const senha = process.env.ADMIN_SENHA || '';
const commit = process.argv.includes('--commit');

if (!usuario || !senha) {
  console.error('erro: defina ADMIN_USUARIO e ADMIN_SENHA no ambiente.');
  process.exit(1);
}

admin.initializeApp({
  credential: admin.credential.cert({
    projectId: env.FIREBASE_PROJECT_ID,
    clientEmail: env.FIREBASE_CLIENT_EMAIL,
    privateKey: env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
  }),
});

const db = admin.firestore();

const senhaHash = createHash('sha256').update(senha, 'utf8').digest('hex');
const doc = {
  id: randomUUID(),
  type: 'admin',
  usuario,
  senha: senhaHash,
};

console.log(`→ project: ${env.FIREBASE_PROJECT_ID}`);
console.log(`→ ação:    ${commit ? 'COMMIT' : 'DRY-RUN (use --commit para escrever)'}`);
console.log(`→ doc:`);
console.log(JSON.stringify({ ...doc, senha: senhaHash.slice(0, 6) + '…' + senhaHash.slice(-4) }, null, 2));

const dup = await db.collection('users').where('usuario', '==', usuario).limit(1).get();
if (!dup.empty) {
  console.error(`\nerro: já existe user com usuario="${usuario}" (docId=${dup.docs[0].id}). Abortando.`);
  process.exit(2);
}

if (!commit) {
  console.log('\ndry-run OK. Rode novamente com --commit para gravar.');
  process.exit(0);
}

const ref = await db.collection('users').add(doc);
console.log(`\n✓ criado docId=${ref.id}`);
process.exit(0);
