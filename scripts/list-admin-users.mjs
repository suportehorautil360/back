// READ-ONLY: lista users com type=admin ou usuario=admin na coleção `users`.
// Uso: node back/scripts/list-admin-users.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
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

admin.initializeApp({
  credential: admin.credential.cert({
    projectId: env.FIREBASE_PROJECT_ID,
    clientEmail: env.FIREBASE_CLIENT_EMAIL,
    privateKey: env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
  }),
});

const db = admin.firestore();
if (env.FIREBASE_DATABASE_ID && env.FIREBASE_DATABASE_ID !== '(default)') {
  db.settings({ databaseId: env.FIREBASE_DATABASE_ID });
}

console.log(`→ project: ${env.FIREBASE_PROJECT_ID}`);
console.log(`→ database: ${env.FIREBASE_DATABASE_ID || '(default)'}\n`);

function redact(v) {
  if (typeof v !== 'string') return v;
  if (v.length > 12) return v.slice(0, 6) + '…' + v.slice(-4);
  return '****';
}

async function listByField(field, value) {
  const snap = await db.collection('users').where(field, '==', value).limit(20).get();
  console.log(`\n=== users where ${field} == "${value}" (${snap.size}) ===`);
  snap.forEach((doc) => {
    const d = doc.data();
    const safe = { ...d };
    if ('senha' in safe) safe.senha = redact(safe.senha);
    if ('passwordHash' in safe) safe.passwordHash = redact(safe.passwordHash);
    console.log(`\n[docId=${doc.id}]`);
    console.log(JSON.stringify(safe, null, 2));
  });
}

try {
  await listByField('type', 'admin');
  await listByField('usuario', 'admin');
} catch (err) {
  console.error('erro:', err.message);
  process.exit(1);
}

process.exit(0);
