import assert from 'node:assert/strict';
import fs from 'node:fs';
const read=(path)=>fs.readFileSync(path,'utf8');
const executable=(source)=>source.replace(/\/\*[\s\S]*?\*\//g,'').replace(/(^|\s)\/\/.*$/gm,'');
const ts=read('src/3d/world/photorealismDirector.ts');
const js=read('src/3d/world/photorealismDirector.js');
const bridge=read('src/3d/world/photorealismSceneBridge.ts');
const bridgeJs=read('src/3d/world/photorealismSceneBridge.js');
const pass=read('src/3d/world/photorealismEnvironmentPass.ts');
const clusters=read('src/3d/world/photorealismAssetClusterPlanner.ts');
const test=read('tests/world/photorealismEnvironmentPass.test.ts');
const passExecutable=executable(pass);
const tsExecutable=executable(ts);
const failures=[];
const must=[
  ['typed-owner',ts.includes('export function buildPhotorealismFrame')],
  ['placement-authority',ts.includes('WorldAssetPlacementPipeline.js')],
  ['material-authority',ts.includes('MaterialAssignmentCore.js')],
  ['water-safety',ts.includes('tree-on-water')],
  ['anti-tiling',ts.includes('antiTiling')],
  ['pbr',ts.includes('normalStrength')&&ts.includes('roughness')],
  ['atmosphere',ts.includes('fogDensity')&&ts.includes('aerialPerspective')],
  ['compat-boundary',js.includes('photorealismDirector.ts')],
  ['bridge-applies-pbr',bridge.includes('applyPhotorealismFrameToScene')&&bridge.includes('material-roughness')],
  ['bridge-provenance',bridge.includes('material-provenance')&&bridge.includes('sourceAuthority')],
  ['bridge-compat-boundary',bridgeJs.includes('photorealismSceneBridge.ts')],
  ['p0-pass',pass.includes('rectangular-water-block')&&pass.includes('water-moire')&&pass.includes('grid-seam')],
  ['p1-parity',pass.includes('parityErrorMeters')&&pass.includes('smooth-wall')],
  ['p2-breakup',pass.includes('snowlineMeters')&&pass.includes('antiTilingPhase')],
  ['p3-instancing',clusters.includes('supportsInstancing')&&clusters.includes('instanceBatchKey')],
  ['p4-water',pass.includes('moireSuppression')&&pass.includes('foamWidthMeters')],
  ['p5-sky',pass.includes('blackSkyGuard')&&pass.includes('skyLuminance')],
  ['asset-first-pipeline',clusters.includes('WorldAssetPlacementPipeline.js')&&clusters.includes('MaterialAssignmentCore.js')],
  ['focused-test',test.includes('buildEnvironmentPassPlan')&&test.includes('planEnvironmentCluster')],
  ['no-editor-runtime-import',!ts.includes('EditorMaterialStudio.js')&&!bridge.includes('EditorMaterialStudio.js')&&!pass.includes('EditorMaterialStudio.js')&&!clusters.includes('EditorMaterialStudio.js')],
  ['no-grid-term',!tsExecutable.includes('GeoCell')&&!tsExecutable.includes('Pindex')&&!passExecutable.includes('GeoCell')&&!passExecutable.includes('Pindex')],
];
for(const [name,ok] of must)if(!ok)failures.push(name);
assert.equal(failures.length,0,failures.join('\n'));
console.log(JSON.stringify({ok:true,suite:'photorealism-director',checks:must.length}));
