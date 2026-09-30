import { readFile } from 'node:fs/promises';

const owners = [
  ['scripts/devServerHelper.ts', 'scripts/devServerHelper.js'],
  ['scripts/checkTechnicalDebt.ts', 'scripts/checkTechnicalDebt.js'],
  ['scripts/checkAssetsManifest.ts', 'scripts/checkAssetsManifest.js'],
  ['scripts/checkPwaInstallability.ts', 'scripts/checkPwaInstallability.js'],
];

const failures = [];
for (const [typed, legacy] of owners) {
  const ts = await readFile(typed, 'utf8').catch(() => null);
  const js = await readFile(legacy, 'utf8').catch(() => null);
  if (!ts) failures.push(`${typed}: TypeScript owner missing`);
  else if (!ts.includes('@ts-nocheck') || !ts.includes('node:')) failures.push(`${typed}: expected Node-native TypeScript boundary marker/imports missing`);
  if (!js) failures.push(`${legacy}: compatibility launcher missing`);
  else if (!js.includes('.ts')) failures.push(`${legacy}: does not route to TypeScript owner`);
}
const manifest = await readFile('scripts/checkAssetsManifest.ts', 'utf8');
if (!manifest.includes('evaluateAssetsManifest')) failures.push('checkAssetsManifest.ts: reusable evaluator missing');
const pwa = await readFile('scripts/checkPwaInstallability.ts', 'utf8');
if (!pwa.includes('evaluatePwaInstallability') || !pwa.includes('parseIconSize')) failures.push('checkPwaInstallability.ts: reusable validators missing');
const debt = await readFile('scripts/checkTechnicalDebt.ts', 'utf8');
if (!debt.includes('parseAddedSourceLines') || !debt.includes('stripQuotedLiterals')) failures.push('checkTechnicalDebt.ts: reusable diff policy helpers missing');

if (failures.length) {
  console.error(`R24 tooling migration failed with ${failures.length} issue(s):`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log(JSON.stringify({ ok: true, suite: 'typescript-tooling-r24', owners: owners.length, compatibilityBoundaries: true, reusableValidators: true }));
