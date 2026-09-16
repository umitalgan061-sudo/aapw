import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const ROOT = resolve(process.cwd());
const required = [
  'src/engine-ts/modernEngine.ts',
  'src/engine-ts/renderBridge.ts',
  'src/engine-ts/persistence.ts',
  'src/engine-ts/typedRuntimeComposition.ts',
  'src/engine-ts/workerRuntime.ts',
  'src/engine-ts/assetPipeline.ts',
  'src/3d/modern/typedMigrationV5.ts',
  'scripts/generateTypedRuntimeMatrixR1.mjs',
  'artifacts/typed-runtime-r1/runtime-compatibility.matrix',
];

const failures = [];
for (const path of required) {
  try { await readFile(resolve(ROOT, path), 'utf8'); } catch { failures.push(`missing required typed-runtime path: ${path}`); }
}

const read = async path => readFile(resolve(ROOT, path), 'utf8');
const packageJson = JSON.parse(await read('package.json'));
if (!String(packageJson.scripts?.['verify:typed-runtime'] ?? '').includes('checkTypedRuntimeModernization')) failures.push('package.json must expose verify:typed-runtime');
if (String(await read('src/engine-ts/typedRuntimeComposition.ts')).match(/\bany\b/g)?.length) failures.push('typedRuntimeComposition.ts must not use explicit any');
if (String(await read('src/engine-ts/workerRuntime.ts')).match(/\bany\b/g)?.length) failures.push('workerRuntime.ts must not use explicit any');
if (String(await read('src/engine-ts/assetPipeline.ts')).match(/\bany\b/g)?.length) failures.push('assetPipeline.ts must not use explicit any');
const matrix = await read('artifacts/typed-runtime-r1/runtime-compatibility.matrix');
const rows = matrix.split('\n').filter(line => /^\d{4}\|/.test(line));
if (rows.length !== 4096) failures.push(`expected 4096 matrix rows, got ${rows.length}`);
if (new Set(rows).size !== rows.length) failures.push('typed runtime matrix is not unique');
if (rows[0] && !rows[0].startsWith('0000|')) failures.push('typed runtime matrix must start at case 0000');
if (rows.at(-1) && !rows.at(-1).startsWith('4095|')) failures.push('typed runtime matrix must end at case 4095');

const migration = await read('src/3d/modern/typedMigrationV5.ts');
for (const forbidden of ['Math.random(', 'eval(', 'new Function(']) if (migration.includes(forbidden)) failures.push(`forbidden nondeterministic/dynamic API in typed migration: ${forbidden}`);
const worker = await read('src/engine-ts/workerRuntime.ts');
if (worker.includes('Math.random(')) failures.push('worker runtime must remain deterministic');

if (failures.length) {
  console.error(`typed runtime modernization gate failed (${failures.length}):`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log(JSON.stringify({ schemaVersion: 1, matrixCases: rows.length, deterministic: true, typedBoundary: true, workerRuntime: true, assetPipeline: true }, null, 2));
