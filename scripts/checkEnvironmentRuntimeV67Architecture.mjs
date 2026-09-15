import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { V67_MANIFEST } from '../src/3d/world/environmentRuntimeV67Manifest.js';
import { V67_POLICY } from '../src/3d/world/environmentRuntimeV67.js';

const files=[
'src/3d/world/environmentRuntimeV67.js',
'src/3d/world/environmentRuntimeIntegrationV67.js',
'src/3d/world/environmentRuntimeHydrologyV67.js',
'src/3d/world/environmentRuntimeWeatherV67.js',
'src/3d/world/environmentRuntimeGroundResponseV67.js',
'src/3d/world/environmentRuntimeBiomeTransitionsV67.js',
'src/3d/world/environmentRuntimeResourcesV67.js',
'src/3d/world/environmentRuntimeInteractionV67.js',
];
for(const path of files){
 const source=await readFile(path,'utf8');
 assert.equal(source.includes('EditorMaterialStudio'),false,path);
 assert.equal(/new\\s+THREE\\./.test(source),false,path);
 assert.equal(/addGeometry|addMesh|scene\\.add\\(/.test(source),false,path);
 assert.ok(source.includes('noWorldMutation')||path.endsWith('V67.js'),path);
}
assert.equal(V67_POLICY.noWorldMutation,true);
assert.equal(V67_POLICY.deterministic,true);
assert.equal(V67_POLICY.placementAuthority,V67_MANIFEST.authorities.placement);
assert.equal(V67_POLICY.materialAuthority,V67_MANIFEST.authorities.material);
assert.ok(V67_MANIFEST.domains.includes('hydrology'));
assert.ok(V67_MANIFEST.domains.includes('resources'));
assert.ok(V67_MANIFEST.domains.includes('interaction'));
assert.ok(V67_MANIFEST.domains.includes('quality-guard'));
console.log('V67 architecture guard PASS');
