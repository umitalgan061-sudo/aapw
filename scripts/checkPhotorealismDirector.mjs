import assert from 'node:assert/strict';
import fs from 'node:fs';
const ts=fs.readFileSync('src/3d/world/photorealismDirector.ts','utf8');
const js=fs.readFileSync('src/3d/world/photorealismDirector.js','utf8');
const failures=[];
const must=[
  ['typed-owner',ts.includes('export function buildPhotorealismFrame')],
  ['placement-authority',ts.includes("WorldAssetPlacementPipeline.js")],
  ['material-authority',ts.includes("MaterialAssignmentCore.js")],
  ['water-safety',ts.includes('tree-on-water')],
  ['anti-tiling',ts.includes('antiTiling')],
  ['pbr',ts.includes('normalStrength')&&ts.includes('roughness')],
  ['atmosphere',ts.includes('fogDensity')&&ts.includes('aerialPerspective')],
  ['compat-boundary',js.includes("photorealismDirector.ts")],
  ['no-editor-runtime-import',!ts.includes('EditorMaterialStudio.js')],
  ['no-grid-term',!ts.includes('GeoCell')&&!ts.includes('Pindex')],
];
for(const [name,ok] of must)if(!ok)failures.push(name);
assert.equal(failures.length,0,failures.join('\n'));
console.log(JSON.stringify({ok:true,suite:'photorealism-director',checks:must.length}));
