/**
 * Saneamento: preenche `currentReading: 0` nos abastecimentos LEGADOS que estão
 * sem o campo (de antes dele existir). Um doc sem currentReading derrubava a
 * listagem do admin (ver fix do formatAbastecimento). Aqui some a inconsistência.
 *
 * SEGURANÇA:
 * - DRY-RUN por padrão: só conta e mostra exemplos. Para gravar, passe `--apply`.
 * - Imprime o projeto + banco (FIREBASE_DATABASE_ID) ANTES — confira se é o certo
 *   (prod vs homolog) antes de aplicar.
 * - Só toca em docs onde currentReading é null/undefined; nunca sobrescreve valor.
 *
 * USO (no diretório do back, com as envs do Firebase carregadas):
 *   node scripts/sanear-current-reading.mjs                 # dry-run (tudo)
 *   node scripts/sanear-current-reading.mjs --prefeitura=ID # dry-run (1 prefeitura)
 *   node scripts/sanear-current-reading.mjs --apply         # GRAVA
 * (carrega .env do diretório automaticamente se existir)
 */
import { existsSync, readFileSync } from "node:fs";
import admin from "firebase-admin";

// --- carrega .env (sem dependência) se as envs ainda não estiverem no ambiente ---
function carregarEnv() {
  if (!existsSync(".env")) return;
  for (const linha of readFileSync(".env", "utf8").split("\n")) {
    const m = /^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/.exec(linha);
    if (!m) continue;
    const chave = m[1];
    let valor = m[2];
    if (
      (valor.startsWith('"') && valor.endsWith('"')) ||
      (valor.startsWith("'") && valor.endsWith("'"))
    ) {
      valor = valor.slice(1, -1);
    }
    if (!(chave in process.env)) process.env[chave] = valor;
  }
}

function credencial() {
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n");
  if (projectId && clientEmail && privateKey) {
    return admin.credential.cert({ projectId, clientEmail, privateKey });
  }
  const path =
    process.env.FIREBASE_SERVICE_ACCOUNT_PATH ??
    process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (path && existsSync(path)) {
    return admin.credential.cert(JSON.parse(readFileSync(path, "utf8")));
  }
  return admin.credential.applicationDefault();
}

async function main() {
  carregarEnv();

  const apply = process.argv.includes("--apply");
  const prefeituraArg = process.argv
    .find((a) => a.startsWith("--prefeitura="))
    ?.split("=")[1];
  const databaseId = process.env.FIREBASE_DATABASE_ID ?? "default";

  admin.initializeApp({ credential: credencial() });
  const db = admin.firestore();
  db.settings({ databaseId, ignoreUndefinedProperties: true });

  console.log("──────────────────────────────────────────");
  console.log(`Projeto : ${process.env.FIREBASE_PROJECT_ID ?? "(default app)"}`);
  console.log(`Banco   : ${databaseId}`);
  console.log(`Modo    : ${apply ? "APLICAR (vai gravar)" : "DRY-RUN (só conta)"}`);
  if (prefeituraArg) console.log(`Filtro  : prefeituraId == ${prefeituraArg}`);
  console.log("──────────────────────────────────────────");

  let query = db.collection("abastecimentos");
  if (prefeituraArg) query = query.where("prefeituraId", "==", prefeituraArg);
  const snap = await query.get();

  const semReading = snap.docs.filter((d) => d.get("currentReading") == null);
  console.log(
    `Total de abastecimentos: ${snap.size} · sem currentReading: ${semReading.length}`,
  );

  if (semReading.length === 0) {
    console.log("Nada a sanear. ✅");
    return;
  }

  console.log("Exemplos:");
  for (const d of semReading.slice(0, 5)) {
    console.log(`  - ${d.id} (prefeitura ${d.get("prefeituraId") ?? "?"})`);
  }

  if (!apply) {
    console.log("\nDRY-RUN: nada foi gravado. Rode com --apply para corrigir.");
    return;
  }

  let batch = db.batch();
  let naBatch = 0;
  let total = 0;
  for (const d of semReading) {
    batch.update(d.ref, { currentReading: 0 });
    if (++naBatch >= 450) {
      await batch.commit();
      total += naBatch;
      batch = db.batch();
      naBatch = 0;
    }
  }
  if (naBatch > 0) {
    await batch.commit();
    total += naBatch;
  }
  console.log(`\n✅ Atualizados ${total} abastecimento(s) com currentReading: 0.`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("Falha no saneamento:", e);
    process.exit(1);
  });
