import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';

const ROOT = new URL('../', import.meta.url);
const required = [
  'src/engine-ts/r43/contracts.ts',
  'src/engine-ts/r43/clock.ts',
  'src/engine-ts/r43/ecs.ts',
  'src/engine-ts/r43/scheduler.ts',
  'src/engine-ts/r43/spatial.ts',
  'src/engine-ts/r43/input.ts',
  'src/engine-ts/r43/simulation.ts',
  'src/engine-ts/r43/render.ts',
  'src/engine-ts/r43/assets.ts',
  'src/engine-ts/r43/network.ts',
  'src/engine-ts/r43/persistence.ts',
  'src/engine-ts/r43/observability.ts',
  'src/engine-ts/r43/security.ts',
  'src/engine-ts/r43/migration.ts',
  'src/engine-ts/r43/runtime.ts',
  'src/engine-ts/r43/browserBridge.ts',
  'src/engine-ts/r43/gameBridge.ts',
  'src/engine-ts/r43/world.ts',
  'src/engine-ts/r43/commandBuffer.ts',
  'src/engine-ts/r43/worker.ts',
  'src/engine-ts/r43/diagnostics.ts',
  'src/engine-ts/r43/index.ts',
];

async function file(path: string): Promise<string> {
  return readFile(new URL(path, ROOT), 'utf8');
}

const failures: string[] = [];
for (const path of required) {
  try {
    await file(path);
  } catch {
    failures.push('missing:' + path);
  }
}

const r43Root = new URL('src/engine-ts/r43/', ROOT);
const entries = await walk(r43Root);
const tsFiles = entries.filter((path) => path.endsWith('.ts'));
const nonTs = entries.filter((path) => !path.endsWith('.ts'));
if (nonTs.length > 0) {
  failures.push(...nonTs.map((path) => 'non-typescript-r43:' + relative(new URL('.', ROOT).pathname, path)));
}

let totalLines = 0;
for (const path of tsFiles) {
  const source = await readFile(path, 'utf8');
  totalLines += source.split('\n').length;
  if (/@ts-nocheck|Math\.random\(|Date\.now\(|eval\(|new Function\(/u.test(source)) {
    failures.push('unsafe-or-untyped-primitive:' + relative(new URL('.', ROOT).pathname, path));
  }
}

const engineIndex = await file('src/engine-ts/index.ts');
if (!engineIndex.includes("export * from './r43/index.ts';")) {
  failures.push('engine-index-missing-r43-export');
}

const testEntries = await walk(new URL('tests/engine-r43/', ROOT));
const testCount = testEntries.filter((path) => path.endsWith('.test.ts')).length;
if (testCount < 10) failures.push('insufficient-r43-regression-suites:' + testCount);

const packageJson = JSON.parse(await file('package.json')) as { scripts?: Record<string, string> };
for (const name of ['verify:r43', 'typecheck:r43', 'test:r43', 'check:r43']) {
  if (!packageJson.scripts?.[name]) failures.push('missing-package-script:' + name);
}

console.info('[r43] ' + JSON.stringify({
  requiredFiles: required.length,
  tsFiles,
  totalLines,
  testCount,
  failures: failures.length,
}));

if (failures.length > 0) {
  for (const failure of failures) console.error('[r43] ' + failure);
  process.exit(1);
}

async function walk(url: URL): Promise<string[]> {
  const directory = url.pathname;
  const out: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) out.push(...await walk(new URL('file://' + path + '/')));
    else if (entry.isFile()) out.push(path);
  }
  return out;
}
