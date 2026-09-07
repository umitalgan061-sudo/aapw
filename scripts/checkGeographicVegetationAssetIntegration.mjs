import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const vegetationPath = path.join(root, 'src/3d/world/vegetation.js');
const adapterPath = path.join(root, 'src/3d/world/geographicVegetationAsset.js');
const workflowPath = path.join(root, '.github/workflows/geographic-vegetation-assets.yml');

const vegetation = fs.readFileSync(vegetationPath, 'utf8');
const adapter = fs.readFileSync(adapterPath, 'utf8');
const workflow = fs.readFileSync(workflowPath, 'utf8');

for (const source of [adapter, workflow]) assert.ok(source.length > 100, 'geographic vegetation source must not be empty');
assert.match(adapter, /GEOGRAPHIC_VEGETATION_ASSET_POLICY/);
assert.match(adapter, /GEOGRAPHIC_VEGETATION_ASSETS/);
assert.match(adapter, /REFERENCE_BIOME_ZONES/);
assert.match(adapter, /terrainMapUvAt/);
assert.match(adapter, /northReferenceCryosphereAtWorldXZ/);
assert.match(adapter, /AssetLoader/);
assert.match(adapter, /repository-authored-vegetation-glb/);
assert.match(adapter, /preserveSourcePbr: true/);
assert.match(adapter, /failClosedToProcedural: true/);
assert.match(adapter, /PROCEDURAL_TREE_NAMES/);
assert.match(adapter, /InstancedMesh/);
assert.match(adapter, /getMatrixAt/);
assert.match(adapter, /sampleHeightMeters/);

for (const name of [
  'birch_trees_R7qMWzb7nk.glb',
  'big_tree_by_3donimus_dnwh762pn_6_na.glb',
  'fall_tree_4GYen9Xm3Kj.glb',
  'dead_tree_n8FhMgMldD.glb',
]) {
  assert.ok(adapter.includes(name), `adapter must mention ${name}`);
  assert.ok(workflow.includes(name), `workflow must hydrate ${name}`);
}

// The adapter is intentionally not wired into the canonical vegetation producer in this PR.
// This check makes that boundary explicit so a dormant asset module cannot be mistaken for a shipped runtime feature.
assert.doesNotMatch(vegetation, /geographicVegetationAsset\.js/);
assert.doesNotMatch(vegetation, /upgradeGeographicVegetationAssets/);
for (const pattern of [/import\s+EditorMaterialStudio/, /new\s+SettlementManager/, /Math\.random\(/]) {
  assert.doesNotMatch(vegetation + adapter, pattern);
}

console.log(JSON.stringify({
  ok: true,
  adapterReady: true,
  canonicalVegetationUntouched: true,
  productionImportPresent: false,
  productionHookPresent: false,
  productionTelemetryPresent: false,
  nextIntegrationRequired: true,
}));
