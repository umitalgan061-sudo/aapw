#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const modules = [
  'dialogueChoices',
  'interactionConfig',
  'interactionEconomy',
  'livingWorldAssetEvidencePolicy',
];

for (const name of modules) {
  const base = `../src/3d/gameplay/${name}`;
  const js = await readFile(new URL(`${base}.js`, import.meta.url), 'utf8');
  const ts = await readFile(new URL(`${base}.ts`, import.meta.url), 'utf8');
  assert.match(js, /Compatibility boundary:/);
  assert.match(js, new RegExp(`from ['"]\\./${name}\\.ts['"]`));
  assert.ok(ts.startsWith('// @ts-nocheck'), `${name}.ts typing bridge missing`);
  assert.equal(ts.includes('EditorMaterialStudio.js'), false);
}

console.log(JSON.stringify({ok:true,migratedModules:modules.length,policy:'gameplay implementation is TypeScript-first'}));
