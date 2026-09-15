import assert from 'node:assert/strict';
import {
  ATMOSPHERE_POLICY,
  GEOLOGY_POLICIES,
  ROAD_POLICIES,
  TERRAIN_SURFACE_POLICIES,
  VEGETATION_POLICIES,
  WATER_SURFACE_POLICIES,
  WORLD_COVERAGE_V52_BUDGET,
  WORLD_COVERAGE_VISUAL_V52_CONTRACT,
} from '../src/3d/world/worldCoverageVisualRuntimeV52Policies.js';

let checks = 0;
const check = (value, message) => { checks += 1; assert.ok(value, message); };
const finite = (value, message) => { checks += 1; assert.ok(Number.isFinite(value), message); };

for (const [name, policy] of Object.entries(TERRAIN_SURFACE_POLICIES)) {
  check(Array.isArray(policy.albedo) && policy.albedo.length === 3, `${name} terrain albedo`);
  policy.albedo.forEach((value, index) => check(value >= 0 && value <= 1, `${name} terrain albedo ${index}`));
  finite(policy.roughness, `${name} terrain roughness`);
  check(policy.roughness >= 0.75, `${name} terrain roughness should be matte enough`);
  check(policy.normalStrength > 0, `${name} terrain normal strength`);
  check(policy.ao > 0 && policy.ao <= 1, `${name} terrain AO`);
  check(policy.variation >= 0, `${name} terrain variation`);
}

for (const [name, policy] of Object.entries(WATER_SURFACE_POLICIES)) {
  for (const key of ['deep', 'shallow']) {
    check(policy[key].length === 3, `${name} water ${key} color`);
    policy[key].forEach((value, index) => check(value >= 0 && value <= 1, `${name} water ${key} color ${index}`));
  }
  check(policy.roughness >= 0.20, `${name} water roughness`);
  check(policy.roughness <= 0.65, `${name} water roughness upper bound`);
  check(policy.metalness <= 0.08, `${name} water metalness`);
  check(policy.normalScale > 0 && policy.normalScale <= 0.30, `${name} water normal scale`);
  check(policy.stripeSuppression >= 0.45 && policy.stripeSuppression <= 0.80, `${name} stripe suppression`);
  check(policy.opacity > 0.70 && policy.opacity <= 1, `${name} water opacity`);
}

for (const [name, policy] of Object.entries(VEGETATION_POLICIES)) {
  check(policy.minScale > 0.70, `${name} vegetation min scale`);
  check(policy.maxScale < 1.35, `${name} vegetation max scale`);
  check(policy.minScale < policy.maxScale, `${name} vegetation scale ordering`);
  check(policy.fadeStart < policy.fadeEnd, `${name} vegetation fade ordering`);
  check(policy.roughness >= 0.80, `${name} vegetation roughness`);
  check(policy.leafRoughness >= 0.75, `${name} foliage roughness`);
}

for (const [name, policy] of Object.entries(GEOLOGY_POLICIES)) {
  check(policy.roughness >= 0.92, `${name} geology roughness`);
  check(policy.normalStrength >= 0.60, `${name} geology normal strength`);
  check(Array.isArray(policy.colorBias) && policy.colorBias.length === 3, `${name} geology color bias`);
  check(policy.edgeContrast > 0, `${name} geology edge contrast`);
  check(policy.talusBias >= 0, `${name} talus bias`);
}

for (const [name, policy] of Object.entries(ROAD_POLICIES)) {
  check(policy.roughness >= 0.85, `${name} road roughness`);
  check(policy.metalness <= 0.02, `${name} road metalness`);
  check(policy.variation >= 0.05, `${name} road variation`);
  check(policy.edgeFade > 0, `${name} road edge fade`);
}

check(ATMOSPHERE_POLICY.blackBackgroundThreshold > 0, 'black background threshold');
check(ATMOSPHERE_POLICY.exposureMin < ATMOSPHERE_POLICY.exposureMax, 'exposure ordering');
check(ATMOSPHERE_POLICY.fogDensityNear > ATMOSPHERE_POLICY.fogDensityFar, 'near fog should be stronger');
check(ATMOSPHERE_POLICY.horizonLift > 0 && ATMOSPHERE_POLICY.horizonLift < 1, 'horizon lift');
check(ATMOSPHERE_POLICY.farMountainDesaturation >= 0, 'far mountain desaturation');

check(WORLD_COVERAGE_V52_BUDGET.nearDetailDistanceMeters < WORLD_COVERAGE_V52_BUDGET.midDetailDistanceMeters, 'detail distance ordering near/mid');
check(WORLD_COVERAGE_V52_BUDGET.midDetailDistanceMeters < WORLD_COVERAGE_V52_BUDGET.farDetailDistanceMeters, 'detail distance ordering mid/far');
check(WORLD_COVERAGE_V52_BUDGET.farDetailDistanceMeters < WORLD_COVERAGE_V52_BUDGET.vegetationMaxVisibleDistanceMeters, 'detail distance ordering far/vegetation');
check(WORLD_COVERAGE_V52_BUDGET.maxMaterialMutationsPerFrame < 200, 'material mutation cap');
check(WORLD_COVERAGE_V52_BUDGET.maxObjectMutationsPerFrame < 250, 'object mutation cap');
check(WORLD_COVERAGE_V52_BUDGET.rescanIntervalFrames >= 4, 'rescan throttle');

check(WORLD_COVERAGE_VISUAL_V52_CONTRACT.materialContract === 'MaterialAssignmentCore', 'material contract name');
check(WORLD_COVERAGE_VISUAL_V52_CONTRACT.placementContract === 'WorldAssetPlacementPipeline', 'placement contract name');
check(WORLD_COVERAGE_VISUAL_V52_CONTRACT.editorRuntimeImportForbidden === true, 'editor runtime import boundary');
check(WORLD_COVERAGE_VISUAL_V52_CONTRACT.geometryAuthoringForbidden === true, 'geometry authoring boundary');
check(WORLD_COVERAGE_VISUAL_V52_CONTRACT.canonicalGeographyRequired === true, 'canonical geography boundary');

console.log(`WORLD_COVERAGE_VISUAL_RUNTIME_V52_POLICY_MATRIX_OK checks=${checks}`);
