#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const modules=[
  'src/3d/auroraRealism',
  'src/3d/gameplay/animalConfig',
  'src/3d/gameplay/interactionFieldReadiness',
];

for(const base of modules){
  const js=await readFile(new URL(`../${base}.js`,import.meta.url),'utf8');
  const ts=await readFile(new URL(`../${base}.ts`,import.meta.url),'utf8');
  assert.match(js,/Compatibility boundary:/);
  assert.match(js,new RegExp(`from ['"]\\./${base.split('/').pop()}\\.ts['"]`));
  assert.ok(ts.startsWith('// @ts-nocheck'),`${base}.ts staged typing bridge missing`);
  assert.equal(ts.includes('EditorMaterialStudio.js'),false);
}
console.log(JSON.stringify({ok:true,migratedModules:modules.length}));
