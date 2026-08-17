// Simula a query do front (use-login.ts): where usuario == X && senha == sha256(Y).
// Se retornar 1 doc com type=admin, o login no /login-admin vai funcionar.
//
// Uso: ADMIN_USUARIO=vinicius ADMIN_SENHA='123456' node back/scripts/verify-admin-login.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { createHash } from 'node:crypto';
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
if (!usuario || !senha) {
  console.error('erro: defina ADMIN_USUARIO e ADMIN_SENHA.');
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

const snap = await db
  .collection('users')
  .where('usuario', '==', usuario)
  .where('senha', '==', senhaHash)
  .limit(1)
  .get();

if (snap.empty) {
  console.error(`✗ login FALHARIA: nenhum doc com usuario="${usuario}" e senha=SHA256("${senha}")`);
  process.exit(2);
}

const doc = snap.docs[0];
const d = doc.data();
console.log(`✓ login OK`);
console.log(`  docId: ${doc.id}`);
console.log(`  type: ${d.type}`);
console.log(`  usuario: ${d.usuario}`);
console.log(`  type === "admin": ${d.type === 'admin'}`);
process.exit(0);
