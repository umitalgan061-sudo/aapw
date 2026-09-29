import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

const ROOT = new URL('../', import.meta.url);
const read = async (path) => readFile(new URL(path, ROOT), 'utf8');
const failures = [];
const assert = (condition, message) => {
  if (!condition) failures.push(message);
};

const walk = async (relative) => {
  const root = new URL(relative + '/', ROOT);
  const entries = await readdir(root, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(relative, entry.name);
    if (entry.isDirectory()) files.push(...await walk(path));
    else if (entry.name.endsWith('.ts')) files.push(path);
  }
  return files;
};

const strictFiles = await walk('src/3d/strict');
const testFiles = await walk('tests/modern/strict-live-core');

for (const file of strictFiles) {
  const source = await read(file);
  assert(!source.includes('@ts-nocheck'), file + ' must not use @ts-nocheck');
  assert(!source.includes('@ts-ignore'), file + ' must not use @ts-ignore');
  assert(!/\bMath\.random\s*\(/.test(source), file + ' must not use ambient randomness');
  assert(!/\bDate\.now\s*\(/.test(source), file + ' must not use wall-clock time');
  for (const forbidden of ["from 'three'", 'from "three"', "from './vendor/", "from '../vendor/"]) {
    assert(!source.includes(forbidden), file + ' has forbidden low-level import: ' + forbidden);
  }
}

const barrel = await read('src/3d/strict/index.ts');
for (const name of [
  'liveCoreTypes', 'cameraRuntime', 'physicsRuntime', 'inputRuntime',
  'assetRuntime', 'renderBackendRuntime', 'renderFramePlanner',
  'streamingRuntime', 'runtimeTelemetry', 'recoveryRuntime',
  'replayRuntime', 'commandRuntime', 'saveRuntime', 'liveCoreRuntime', 'runtimeHealthBudget',
]) assert(barrel.includes("./" + name + ".ts"), 'barrel missing ' + name);

const tsconfig = JSON.parse(await read('tsconfig.strict-live-core-r23.json'));
assert(tsconfig.compilerOptions?.allowJs === false, 'strict boundary must disable JS');
assert(tsconfig.compilerOptions?.exactOptionalPropertyTypes === true, 'exact optional typing must remain enabled');
assert(Array.isArray(tsconfig.include) && tsconfig.include.some((value) => value.includes('src/3d/strict')), 'strict sources must be included');

for (const file of testFiles) {
  const source = await read(file);
  assert(source.includes("from 'vitest'"), file + ' must be a Vitest suite');
}

const packageJson = JSON.parse(await read('package.json'));
const healthSource = await read('src/3d/strict/runtimeHealthBudget.ts');
assert(!healthSource.includes('Math.random'), 'health budget must be deterministic');
assert(!healthSource.includes('Date.now'), 'health budget must not use wall-clock time');
assert(packageJson.scripts?.['typecheck:strict-live-core-r23'], 'missing typecheck script');
assert(packageJson.scripts?.['test:strict-live-core-r23'], 'missing test script');
assert(packageJson.scripts?.['verify:strict-live-core-r23'], 'missing verify script');

if (failures.length) {
  console.error('[r23-strict-live-core] guard failed');
  for (const failure of failures) console.error(' - ' + failure);
  process.exit(1);
}

console.log('[r23-strict-live-core] architecture guard passed');
console.log('[r23-strict-live-core] strict source files:', strictFiles.length);
console.log('[r23-strict-live-core] strict test files:', testFiles.length);