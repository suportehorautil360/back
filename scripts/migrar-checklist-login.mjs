// Migra a coleção `clientes`: adiciona checklistLogin = { cpfSenha: true, chassi: false }
// em docs que não têm o campo. Backward compat: docs com o campo são ignorados.
//
// Uso:
//   node back/scripts/migrar-checklist-login.mjs           # DRY-RUN
//   node back/scripts/migrar-checklist-login.mjs --commit  # grava
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
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
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
const commit = process.argv.includes('--commit');

console.log(`→ project: ${env.FIREBASE_PROJECT_ID}`);
console.log(`→ ação:    ${commit ? 'COMMIT' : 'DRY-RUN (use --commit para gravar)'}`);

const snap = await db.collection('clientes').get();
let atualizados = 0, jaTem = 0;

for (const doc of snap.docs) {
  const data = doc.data();
  if (data.checklistLogin && typeof data.checklistLogin === 'object') { jaTem++; continue; }
  console.log(`  · ${doc.id} — set checklistLogin = { cpfSenha: true, chassi: false }`);
  if (commit) {
    await doc.ref.update({ checklistLogin: { cpfSenha: true, chassi: false } });
  }
  atualizados++;
}

console.log(`\nTotal: ${snap.size} clientes | ${atualizados} atualizados | ${jaTem} já OK`);
if (!commit) console.log(`\nDry-run OK. Rode com --commit pra gravar.`);
process.exit(0);
