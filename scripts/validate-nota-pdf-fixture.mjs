#!/usr/bin/env node
/**
 * Valida o PDF demo de posto (parse + campos fiscais).
 * Uso: node scripts/validate-nota-pdf-fixture.mjs
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const fixtureDir = join(
  root,
  'src/modules/notas-fiscais/fixtures',
);
const pdfPath = join(fixtureDir, 'danfe_posto_combustivel_demo.pdf');
const expectedPath = join(
  fixtureDir,
  'danfe_posto_combustivel_demo.expected.json',
);

const { parseDanfePdf } = await import(
  join(root, 'dist/modules/notas-fiscais/helpers/parse-danfe-pdf.helper.js')
);

const buffer = readFileSync(pdfPath);
const expected = JSON.parse(readFileSync(expectedPath, 'utf8'));

const parsed = await parseDanfePdf(
  buffer,
  'danfe_posto_combustivel_demo.pdf',
);

const checks = [
  ['accessKey', expected.accessKey],
  ['value', expected.value],
  ['documentType', expected.documentType],
  ['parseCompleteness', expected.parseCompleteness],
];

let ok = true;
for (const [field, want] of checks) {
  if (parsed[field] !== want) {
    console.error(`✗ ${field}: esperado ${want}, recebido ${parsed[field]}`);
    ok = false;
  }
}

if (!ok) {
  process.exit(1);
}

console.log('✓ danfe_posto_combustivel_demo.pdf parseado com sucesso');
console.log(`  chave: ${parsed.accessKey}`);
console.log(`  valor: R$ ${parsed.value}`);
