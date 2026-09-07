import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');
const runtime = read('src/3d/gameplay/livingWorldRuntimeAdapter.js');
const geography = read('src/3d/gameplay/livingWorldGeographyAdapter.js');
const visual = read('src/3d/gameplay/livingWorldAssetVisualAdapter.js');
const surface = read('src/3d/gameplay/livingWorldGeographicSurfaceContract.js');
const scene = read('src/3d/sceneManager.js');

assert.match(geography, /prepareWorldAssetForPlacement/);
assert.match(geography, /auditWorldAssetPlacement/);
assert.match(visual, /MaterialAssignmentCore\.js/);
assert.match(visual, /WorldAssetPlacementPipeline\.js/);
assert.match(visual, /buildRecommendedLayerRecipe/);
assert.match(visual, /autoAssignMaterials/);
assert.match(surface, /WorldAssetPlacementPipeline\.js/);
assert.match(surface, /auditLivingWorldAsset/);

for (const [label, source] of Object.entries({ runtime, geography, visual, surface })) {
  assert.doesNotMatch(source, /(?:from|import)\s+['"].*EditorMaterialStudio\.js['"]/i, `${label} must not import EditorMaterialStudio at runtime`);
}
assert.match(runtime, /livingWorldGeographicSurfaceAudit/);
assert.match(runtime, /surfaceZone/);
assert.match(runtime, /buildLivingWorldVisualEvidence/);
assert.match(runtime, /resolveLivingWorldActorSurfaceProfile/);
assert.match(runtime, /sampleSlopeDegrees/);
assert.match(runtime, /sampleWaterDepth/);
assert.match(runtime, /sampleHeightMeters/);
assert.match(runtime, /nearestRoadDistance/);
assert.match(runtime, /nearestSettlementDistance/);

// Existing world placement ownership must remain explicit in scene/runtime code.
assert.match(scene, /WorldAssetPlacementPipeline/);
assert.match(scene, /prepareWorldAssetForPlacement/);
assert.doesNotMatch(scene, /from\s+['"].*EditorMaterialStudio\.js['"]/i);

// The geographic adapter must remain the canonical source of region/profile decisions rather than
// embedding an unrelated second biome catalog in the new runtime adapter.
assert.match(runtime, /resolveLivingWorldGeography/);
assert.doesNotMatch(runtime, /REGION_ASSET_PROFILES\s*=|BIOME_TO_REGION\s*=/);
assert.doesNotMatch(surface, /REGION_ASSET_PROFILES\s*=|BIOME_TO_REGION\s*=/);

// Placement metadata must contain enough context for deterministic post-load inspection.
const requiredRuntimeFields = [
  'region', 'profileId', 'habitatValid', 'habitatReason', 'normalizedReference',
  'slopeDegrees', 'waterDepth', 'settlementDistance', 'roadDistance', 'surfaceZone', 'surfaceAuditOk', 'digest',
];
for (const field of requiredRuntimeFields) assert.match(runtime, new RegExp(field.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));

// Shared authority names are checked literally because changing them silently would permit a
// second implementation to creep into the living-world runtime.
assert.equal((visual.match(/MaterialAssignmentCore\.js/g) || []).length >= 1, true);
assert.equal((visual.match(/WorldAssetPlacementPipeline\.js/g) || []).length >= 1, true);
assert.equal((surface.match(/WorldAssetPlacementPipeline\.js/g) || []).length >= 1, true);

// Asset-first references are constrained to approved authored model families.
const assetReferences = [...geography.matchAll(/assets\/models\/([A-Za-z0-9_./-]+\.(?:fbx|glb|blend))/g)].map((m) => m[0]);
assert.ok(assetReferences.length >= 20, `too few authored model references: ${assetReferences.length}`);
assert.ok(assetReferences.every((entry) => /assets\/models\/(?:characters|animals|creatures|dragons|fbx)\//.test(entry)));
assert.ok(!assetReferences.some((entry) => /placeholder|primitive|cube|sphere|capsule/i.test(entry)));

console.log(JSON.stringify({
  ok: true,
  sharedMaterialAuthority: 'MaterialAssignmentCore.js',
  sharedPlacementAuthority: 'WorldAssetPlacementPipeline.js',
  authoredModelReferences: assetReferences.length,
  runtimeSurfaceFields: requiredRuntimeFields.length,
}));
console.log('LIVING_WORLD_PLACEMENT_BRIDGE_PASS');
