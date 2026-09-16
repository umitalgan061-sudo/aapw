#!/usr/bin/env node
import { readFile, readdir, stat } from 'node:fs/promises';
import { join, relative, extname } from 'node:path';
import process from 'node:process';

const root = process.cwd();
const failures = [];
const notes = [];

const readJson = async (path) => JSON.parse(await readFile(path, 'utf8'));
const walk = async (directory) => {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === 'dist-types' || entry.name.startsWith('.git')) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await walk(path));
    else result.push(path);
  }
  return result;
};

const assert = (condition, message) => {
  if (!condition) failures.push(message);
};

const packageJson = await readJson(join(root, 'package.json'));
const tsconfig = await readJson(join(root, 'tsconfig.json'));
const viteConfig = await readFile(join(root, 'vite.config.ts'), 'utf8');

assert(packageJson.type === 'module', 'package.json must use native ESM.');
assert(packageJson.engines?.node?.includes('24.21.0'), 'Node 24.21.0 LTS baseline is required.');
assert(packageJson.devDependencies?.typescript?.startsWith('^7.'), 'TypeScript 7 is required.');
assert(packageJson.devDependencies?.vite?.startsWith('^8.'), 'Vite 8 is required.');
assert(packageJson.devDependencies?.vitest?.startsWith('^4.'), 'Vitest 4 is required.');
assert(tsconfig.compilerOptions?.strict === true, 'TypeScript strict mode must be enabled.');
assert(tsconfig.compilerOptions?.noUncheckedIndexedAccess === true, 'noUncheckedIndexedAccess must be enabled.');
assert(tsconfig.compilerOptions?.exactOptionalPropertyTypes === true, 'exactOptionalPropertyTypes must be enabled.');
assert(tsconfig.compilerOptions?.module === 'ESNext', 'ESNext module target is required.');
assert(tsconfig.compilerOptions?.target === 'ES2024', 'ES2024 syntax target is required.');
assert(viteConfig.includes("modern: 'modern.html'"), 'modern.html must be part of the production MPA.');

const coreRoot = join(root, 'src', 'core');
const files = await walk(coreRoot);
const tsFiles = files.filter((path) => extname(path) === '.ts');
const jsFiles = files.filter((path) => extname(path) === '.js' || extname(path) === '.mjs');
assert(tsFiles.length >= 20, `Expected at least 20 TypeScript core modules; found ${tsFiles.length}.`);
assert(jsFiles.length === 0, `The new core must not introduce JavaScript modules; found ${jsFiles.length}.`);

const allowedDomFiles = ['accessibility.ts', 'browserLifecycle.ts', 'capabilities.ts'];
const boundaryTimeFiles = ['legacyBridge.ts', 'browserLifecycle.ts', 'runtimeConfig.ts', 'worldStore.ts'];
const forbiddenPatterns = [
  { regex: /\bany\b/g, message: 'explicit any is forbidden in the modern core.' },
  { regex: /\b(?:eval|Function)\s*\(/g, message: 'dynamic code execution is forbidden in the modern core.' },
  { regex: /from\s+['"](?:\.\/|\.\.\/)*[^'".]+['"]/g, message: 'extensionless relative imports are forbidden; use explicit ESM-compatible paths.' },
  { regex: /require\s*\(/g, message: 'CommonJS require is forbidden in the modern core.' },
];

for (const file of tsFiles) {
  const source = await readFile(file, 'utf8');
  const rel = relative(root, file).replaceAll('\\', '/');
  for (const pattern of forbiddenPatterns) {
    if (pattern.regex.test(source)) failures.push(`${rel}: ${pattern.message}`);
    pattern.regex.lastIndex = 0;
  }
  if (source.includes('Math.random(')) failures.push(`${rel}: Math.random is not allowed in deterministic core code.`);
  if (source.includes('Date.now(') && !boundaryTimeFiles.some((name) => rel.endsWith(name))) notes.push(`${rel}: Date.now is present; confirm it is boundary-only.`);
  if (source.includes('document.') && !allowedDomFiles.some((name) => rel.endsWith(name))) notes.push(`${rel}: direct DOM access exists; keep presentation ownership explicit.`);
}

const requiredFiles = [
  'src/core/domain/contracts.ts',
  'src/core/runtime/runtimeKernel.ts',
  'src/core/runtime/deterministicClock.ts',
  'src/core/state/immutableStore.ts',
  'src/core/render/renderContract.ts',
  'src/core/performance/adaptiveQuality.ts',
  'src/core/assets/assetRegistry.ts',
  'src/core/net/networkPolicy.ts',
  'src/core/worker/workerPool.ts',
  'src/core/telemetry/runtimeTelemetry.ts',
  'src/core/ui/accessibility.ts',
  'src/main.ts',
  'modern.html',
  'tests/core/runtimeCore.test.ts',
];
for (const file of requiredFiles) {
  try { await stat(join(root, file)); }
  catch { failures.push(`Missing required modernisation file: ${file}`); }
}

const report = {
  ok: failures.length === 0,
  modernCoreTypeScriptFiles: tsFiles.length,
  modernCoreJavaScriptFiles: jsFiles.length,
  failures,
  notes,
};
console.log(JSON.stringify(report, null, 2));
if (failures.length) process.exitCode = 1;
