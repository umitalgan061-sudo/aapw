#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const modules=[
'livingWorldFaunaActivityBudget','livingWorldFaunaHabitatBalancer','livingWorldFaunaSignalRouter',
'livingWorldGroupAiPolicy','livingWorldGroupDirectorAdapter','livingWorldEcologyPolicy','livingWorldEventDirectorAdapter',
];
for(const name of modules){
  const js=await readFile(new URL(`../src/3d/gameplay/${name}.js`,import.meta.url),'utf8');
  const ts=await readFile(new URL(`../src/3d/gameplay/${name}.ts`,import.meta.url),'utf8');
  assert.match(js,/Compatibility boundary:/);
  assert.match(js,new RegExp(`from ['"]\\./${name}\\.ts['"]`));
  assert.ok(ts.startsWith('// @ts-nocheck'));
  assert.equal(ts.includes('EditorMaterialStudio.js'),false);
}
console.log(JSON.stringify({ok:true,migratedModules:modules.length,domain:'fauna-and-living-world-policies'}));
