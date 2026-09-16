#!/usr/bin/env node
import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';

const root = process.cwd();
const failures = [];
const required = [
  'src/3d/modern/v5/domain.ts',
  'src/3d/modern/v5/ecs.ts',
  'src/3d/modern/v5/commandBus.ts',
  'src/3d/modern/v5/scheduler.ts',
  'src/3d/modern/v5/assetGraph.ts',
  'src/3d/modern/v5/worldQuery.ts',
  'src/3d/modern/v5/network.ts',
  'src/3d/modern/v5/render.ts',
  'src/3d/modern/v5/input.ts',
  'src/3d/modern/v5/persistence.ts',
  'src/3d/modern/v5/observability.ts',
  'src/3d/modern/v5/security.ts',
  'src/3d/modern/v5/platform.ts',
  'src/3d/modern/v5/runtime.ts',
  'src/3d/modern/v5/index.ts',
  'tests/modern-v5/v5Platform.test.ts',
  'tests/modern-v5/v5Runtime.test.ts',
];

const read = async (path) => readFile(join(root, path), 'utf8');
for (const path of required) {
  try { await read(path); } catch { failures.push(`missing:${path}`); }
}

for (const path of required.filter((value) => value.endsWith('.ts'))) {
  let source = '';
  try { source = await read(path); } catch { continue; }
  if (/\bMath\.random\s*\(/.test(source)) failures.push(`nondeterministic:${path}:Math.random`);
  if (/\beval\s*\(|\bnew\s+Function\s*\(/.test(source)) failures.push(`unsafe-eval:${path}`);
  if (/\/\* eslint-disable/.test(source)) failures.push(`lint-bypass:${path}`);
  if (/\bany\b/.test(source)) failures.push(`explicit-any:${path}`);
  if (!/export\s+(?:interface|type|class|const|function)/.test(source) && !path.endsWith('/index.ts')) failures.push(`no-public-typed-surface:${path}`);
}

const walk = async (directory) => {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'dist' || entry.name === 'coverage') continue;
    const absolute = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(absolute));
    else files.push(absolute);
  }
  return files;
};

const sourceFiles = await walk(join(root, 'src'));
const javascript = sourceFiles.filter((file) => /\.(?:js|mjs|cjs)$/.test(file));
const typed = sourceFiles.filter((file) => /\.ts$/.test(file));
const modernLegacyBoundary = javascript.filter((file) => relative(root, file).startsWith('src/3d/'));

const packageSource = await read('package.json');
if (!packageSource.includes('"type":"module"') && !packageSource.includes('"type": "module"')) failures.push('package:not-esm');
if (!packageSource.includes('"typescript"')) failures.push('package:typescript-missing');
if (!packageSource.includes('verify:modern:v5')) failures.push('package:verify:modern:v5 missing');

const threshold = 0.35;
const typedRatio = sourceFiles.length === 0 ? 1 : typed.length / sourceFiles.length;
if (typedRatio < threshold) failures.push(`typed-ratio:${typedRatio.toFixed(3)}<${threshold}`);

console.log(JSON.stringify({
  gate: 'complete-typescript-platform-v5',
  requiredFiles: required.length,
  javascriptFiles: javascript.length,
  threeDJavaScriptFiles: modernLegacyBoundary.length,
  typescriptFiles: typed.length,
  typedRatio: Number(typedRatio.toFixed(4)),
  threshold,
  failures,
}, null, 2));

if (failures.length > 0) {
  console.error(`TypeScript platform v5 gate failed with ${failures.length} finding(s).`);
  process.exit(1);
}
console.log('TypeScript platform v5 gate passed.');
