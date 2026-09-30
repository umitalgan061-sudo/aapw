import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import process from 'node:process';

const ROOT = new URL('../src/', import.meta.url).pathname;
const failures = [];
const activeJs = [];
const legacyJs = [];
const vendorJs = [];

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const out = [];
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.name === 'node_modules' || entry.name === 'dist') continue;
    if (entry.isDirectory()) out.push(...await walk(path));
    else if (entry.isFile()) out.push(path);
  }
  return out;
}

for (const file of await walk(ROOT)) {
  const rel = relative(ROOT, file).replaceAll('\\', '/');
  if (!rel.endsWith('.js')) continue;
  if (rel.startsWith('3d/vendor/')) { vendorJs.push(rel); continue; }
  if (rel.endsWith('.legacy.js')) { legacyJs.push(rel); continue; }

  activeJs.push(rel);
  const tsPath = file.replace(/\.js$/u, '.ts');
  const [source, owner] = await Promise.all([
    readFile(file, 'utf8').catch(() => ''),
    readFile(tsPath, 'utf8').catch(() => null),
  ]);

  if (!owner) failures.push(`${rel}: missing TypeScript owner`);
  if (!source.includes('TypeScript ownership compatibility boundary.')) {
    failures.push(`${rel}: active JavaScript is not explicitly compatibility-only`);
  }
  const stem = rel.slice(0, -3).split('/').pop();
  if (!source.includes(`import * as __typed from './${stem}.ts';`)) {
    failures.push(`${rel}: typed owner import missing`);
  }
  if (!source.includes('export * from')) failures.push(`${rel}: re-export missing`);
}

if (failures.length) {
  console.error(`Active TypeScript ownership gate failed with ${failures.length} issue(s).`);
  for (const failure of failures.slice(0, 200)) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(JSON.stringify({
  ok: true,
  activeJavaScriptFiles: activeJs.length,
  compatibilityShims: activeJs.length,
  archivedLegacyFiles: legacyJs.length,
  vendoredJavaScriptFiles: vendorJs.length,
  policy: 'all-active-production-JS-must-be-TS-compatibility-only',
}, null, 2));
