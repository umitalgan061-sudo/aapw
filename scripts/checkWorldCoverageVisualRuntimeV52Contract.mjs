import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const runtime = fs.readFileSync(path.join(ROOT, 'src/3d/world/worldCoverageVisualRuntimeV52.js'), 'utf8');
const policy = fs.readFileSync(path.join(ROOT, 'src/3d/world/worldCoverageVisualRuntimeV52Policies.js'), 'utf8');
const html = fs.readFileSync(path.join(ROOT, 'game3d.html'), 'utf8');
const sceneManager = fs.readFileSync(path.join(ROOT, 'src/3d/sceneManager.js'), 'utf8');

let checks = 0;
const requiredRuntime = [
  'installWorldCoverageVisualRuntimeV52',
  'updateWorldCoverageVisualRuntimeV52',
  'disposeWorldCoverageVisualRuntimeV52',
  'createWorldCoverageVisualRuntimeV52Report',
  'MaterialAssignmentCore',
  'WorldAssetPlacementPipeline',
  'geometryAuthoringForbidden',
  'canonicalGeography',
  'P0',
  'P1',
  'P2',
  'P3',
  'P4',
  'P5',
];
for (const token of requiredRuntime) {
  checks += 1;
  assert.ok(runtime.includes(token), `runtime token missing: ${token}`);
}

const forbiddenRuntimeImports = [
  'EditorMaterialStudio.js',
  'EditorAutoTexture.js',
  '/editor/EditorGamePatchPreview',
  'new THREE.BoxGeometry',
  'new THREE.ConeGeometry',
  'new THREE.CylinderGeometry',
  'new THREE.SphereGeometry',
];
for (const token of forbiddenRuntimeImports) {
  checks += 1;
  assert.equal(runtime.includes(token), false, `runtime must not contain ${token}`);
}

const requiredPolicyTokens = [
  'WORLD_COVERAGE_VISUAL_V52_ID',
  'WORLD_COVERAGE_V52_BUDGET',
  'TERRAIN_SURFACE_POLICIES',
  'WATER_SURFACE_POLICIES',
  'VEGETATION_POLICIES',
  'GEOLOGY_POLICIES',
  'ROAD_POLICIES',
  'ATMOSPHERE_POLICY',
  'V52_ACCEPTANCE',
  'V52_EVIDENCE_SAMPLE_POINTS',
];
for (const token of requiredPolicyTokens) {
  checks += 1;
  assert.ok(policy.includes(token), `policy token missing: ${token}`);
}

checks += 1;
assert.match(html, /worldCoverageVisualRuntimeV52\.js/);
checks += 1;
assert.ok(html.indexOf('worldCoverageVisualRuntimeV52.js') < html.indexOf("./src/3d/game3d.js"), 'visual runtime must load first');

const productionFiles = [
  'src/3d/world/worldReferenceSurfaceTerrainVisual.js',
  'src/3d/world/chunkManager.js',
  'src/3d/world/water.js',
  'src/3d/world/vegetation.js',
  'src/3d/world/roads.js',
];
for (const relative of productionFiles) {
  const absolute = path.join(ROOT, relative);
  if (!fs.existsSync(absolute)) continue;
  const source = fs.readFileSync(absolute, 'utf8');
  checks += 1;
  assert.equal(source.includes('EditorMaterialStudio.js'), false, `${relative} cannot import editor material UI`);
}

const overlapTokens = ['ChunkManager', 'worldReferenceSurfaceTerrainVisual', 'createScene'];
for (const token of overlapTokens) {
  checks += 1;
  assert.ok(runtime.includes(token) || html.includes(token) || sceneManager.includes(token), `expected integration vocabulary ${token}`);
}

console.log(`WORLD_COVERAGE_VISUAL_RUNTIME_V52_CONTRACT_OK checks=${checks}`);
