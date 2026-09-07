import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const vegetationPath = path.join(root, 'src/3d/world/vegetation.js');
const adapterPath = path.join(root, 'src/3d/world/geographicVegetationAsset.js');
const workflowPath = path.join(root, '.github/workflows/geographic-vegetation-assets.yml');
const docsPath = path.join(root, 'docs/GEOGRAPHIC_VEGETATION_RUNTIME.md');

const vegetation = fs.readFileSync(vegetationPath, 'utf8');
const adapter = fs.readFileSync(adapterPath, 'utf8');
const workflow = fs.readFileSync(workflowPath, 'utf8');
const docs = fs.readFileSync(docsPath, 'utf8');

assert.ok(vegetation.length > 1000);
assert.ok(adapter.length > 1000);
assert.ok(workflow.length > 500);
assert.ok(docs.length > 1000);
assert.doesNotMatch(vegetation, /geographicVegetationAsset\.js/);
assert.doesNotMatch(vegetation, /upgradeGeographicVegetationAssets/);
assert.match(adapter, /GEOGRAPHIC_VEGETATION_ASSETS/);
assert.match(adapter, /REFERENCE_BIOME_ZONES/);
assert.match(adapter, /AssetLoader/);
assert.match(adapter, /preserveSourcePbr: true/);
assert.match(adapter, /failClosedToProcedural: true/);
assert.match(adapter, /InstancedMesh/);
assert.match(adapter, /getMatrixAt/);
for (const asset of ['birch_trees_R7qMWzb7nk.glb','big_tree_by_3donimus_dnwh762pn_6_na.glb','fall_tree_4GYen9Xm3Kj.glb','dead_tree_n8FhMgMldD.glb']) {
  assert.match(adapter, new RegExp(asset.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(workflow, new RegExp(asset.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
}
assert.match(docs, /canonical terrain/);
assert.match(docs, /fail-closed/);
assert.match(docs, /18–42%/);
for (const pattern of [/import\s+EditorMaterialStudio/, /new\s+SettlementManager/, /Math\.random\(/]) assert.doesNotMatch(vegetation + adapter, pattern);
console.log(JSON.stringify({ ok:true, canonicalVegetationUntouched:true, adapterReady:true, productionIntegrationDeferred:true, assetFamilies:4, documented:true }));
