#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';

const root = new URL('../src/3d/', import.meta.url);
const MIGRATION_MARKER = 'Compatibility boundary:';

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const absolute = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(absolute));
    else if (entry.isFile()) files.push(absolute);
  }
  return files;
}

const files = await walk(root);
const jsFiles = files.filter(file => file.endsWith('.js'));
const tsFiles = new Set(files.filter(file => file.endsWith('.ts')));
const paired = [];
const migrated = [];
const nonBarrelPairs = [];

for (const file of jsFiles) {
  const rel = relative(new URL('../src/3d/', import.meta.url).pathname, file).replaceAll('\\', '/');
  const sibling = file.slice(0, -3) + '.ts';
  if (!tsFiles.has(sibling)) continue;
  paired.push(rel);
  const source = await readFile(file, 'utf8');
  const expectedExport = `from './${file.split('/').pop().replace(/\\.js$/, '')}.ts'`;
  if (source.includes(MIGRATION_MARKER) && source.includes(expectedExport)) migrated.push(rel);
  else nonBarrelPairs.push(rel);
}

assert.equal(nonBarrelPairs.length, 0, `paired JS implementations remain: ${nonBarrelPairs.join(', ')}`);
assert.ok(migrated.length >= 20, `migration wave unexpectedly regressed: only ${migrated.length} TS-backed modules`);

const report = {
  sourceRoot: 'src/3d',
  jsImplementationsRemaining: jsFiles.length - migrated.length,
  tsModules: tsFiles.size,
  tsBackedLegacyBarrels: migrated.length,
  pairedModules: paired.length,
  policy: 'paired .js files must be compatibility barrels to .ts implementations',
};
const digest = createHash('sha256').update(JSON.stringify({ paired, migrated, report })).digest('hex');
console.log(JSON.stringify({ ok: true, digest, ...report }));
