import { readFile, readdir } from 'node:fs/promises';
import { join, relative } from 'node:path';

const root = new URL('../src/3d/strict/r31/', import.meta.url).pathname;
const failures = [];
const files = [];

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) await walk(path);
    else if (entry.isFile() && entry.name.endsWith('.ts')) files.push(path);
  }
}

await walk(root);
for (const file of files) {
  const source = await readFile(file, 'utf8');
  const name = relative(root, file).replaceAll('\\', '/');
  if (source.includes('@ts-nocheck')) failures.push(`${name}: @ts-nocheck`);
  if (source.includes('@ts-ignore')) failures.push(`${name}: @ts-ignore`);
  if (source.includes('Math.random(')) failures.push(`${name}: ambient randomness`);
  if (source.includes('Date.now(')) failures.push(`${name}: ambient wall clock`);
  if (source.includes('eval(')) failures.push(`${name}: eval`);
  if (source.includes('new Function(')) failures.push(`${name}: dynamic Function`);
  if (source.length < 100) failures.push(`${name}: suspiciously small module`);
}

const indexSource = await readFile(new URL('../src/3d/modern/index.ts', import.meta.url), 'utf8');
if (!indexSource.includes("../strict/r31/indexR31.ts")) failures.push('modern/index.ts: R31 barrel not exported');

const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
for (const script of ['verify:r31','typecheck:r31','test:r31','check:r31']) {
  if (typeof packageJson.scripts?.[script] !== 'string') failures.push(`package.json: missing ${script}`);
}

if (failures.length) {
  console.error(`R31 strict runtime gate failed with ${failures.length} issue(s).`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log(JSON.stringify({
  ok: true,
  modules: files.length,
  policy: 'strict-r31-no-escape-hatches-no-ambient-randomness',
}, null, 2));
