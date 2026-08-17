// READ-ONLY: busca cliente "Vrental" e mostra: config, equipamentos (chassis), acessos (users).
// Uso: node back/scripts/lookup-cliente-vrental.mjs [termo]
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import admin from 'firebase-admin';

const here = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(here, '..', '.env');
const env = Object.fromEntries(
  readFileSync(envPath, 'utf8').split('\n')
    .filter((l) => l && !l.trim().startsWith('#') && l.includes('='))
    .map((l) => { const i = l.indexOf('='); let v = l.slice(i+1).trim(); if ((v.startsWith('"')&&v.endsWith('"'))||(v.startsWith("'")&&v.endsWith("'"))) v = v.slice(1,-1); return [l.slice(0,i).trim(), v]; }),
);
admin.initializeApp({
  credential: admin.credential.cert({
    projectId: env.FIREBASE_PROJECT_ID,
    clientEmail: env.FIREBASE_CLIENT_EMAIL,
    privateKey: env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
  }),
});
const db = admin.firestore();

const termo = (process.argv[2] || 'vrental').toLowerCase();

function redact(v) {
  if (typeof v !== 'string') return v;
  if (v.length > 12) return v.slice(0, 6) + '…' + v.slice(-4);
  return '****';
}

console.log(`→ project: ${env.FIREBASE_PROJECT_ID}`);
console.log(`→ termo: "${termo}"\n`);

// 1) clientes
const snap = await db.collection('clientes').get();
const matches = snap.docs.filter((d) => {
  const nome = String(d.get('nome') ?? '').toLowerCase();
  return nome.includes(termo);
});
console.log(`=== CLIENTES matching "${termo}" (${matches.length}) ===`);
for (const c of matches) {
  const d = c.data();
  console.log(`\n[docId=${c.id}]`);
  console.log(`  nome: ${d.nome}`);
  console.log(`  uf: ${d.uf}`);
  console.log(`  tipoCliente: ${d.tipoCliente}`);
  console.log(`  checklistLogin: ${JSON.stringify(d.checklistLogin ?? '(sem — default cpfSenha:true, chassi:false)')}`);

  // 2) equipamentos dessa prefeitura
  const eqSnap = await db.collection('equipamentos').where('prefeituraId', '==', c.id).limit(10).get();
  console.log(`\n  --- EQUIPAMENTOS (${eqSnap.size}) ---`);
  eqSnap.forEach((e) => {
    const eq = e.data();
    console.log(`  [${e.id}] chassis="${eq.chassis ?? ''}" marca="${eq.marca ?? ''}" modelo="${eq.modelo ?? ''}"`);
  });

  // 3) users vinculados
  const usersSnap = await db.collection('users').where('prefeituraId', '==', c.id).limit(20).get();
  console.log(`\n  --- USERS vinculados (${usersSnap.size}) ---`);
  usersSnap.forEach((u) => {
    const usr = u.data();
    console.log(`  [${u.id}] usuario="${usr.usuario ?? ''}" type=${usr.type} vinculo=${usr.vinculo ?? '-'} senha=${redact(usr.senha ?? '')}`);
  });

  // 4) funcionarios/operadores vinculados
  const funcSnap = await db.collection('operadores').where('prefeituraId', '==', c.id).limit(20).get();
  console.log(`\n  --- OPERADORES/FUNCIONARIOS (${funcSnap.size}) ---`);
  funcSnap.forEach((f) => {
    const fn = f.data();
    console.log(`  [${f.id}] nome="${fn.nome ?? ''}" cpf=${fn.cpf ?? '-'} status=${fn.status ?? '-'} tipo=${fn.tipo ?? '-'} tem_senhaHash=${!!fn.senhaHash}`);
  });
}
process.exit(0);
