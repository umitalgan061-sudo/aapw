#!/usr/bin/env node
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  WORLD_SURFACE_POLICY_PRESETS,
  evaluateWorldSurfacePlacement,
  resolveWorldSurfacePlacement,
  resolveWorldSurfacePolicy,
} from '../src/3d/world/WorldAssetPlacementPipeline.js';
import { resolveStructureSurfaceProfile } from '../src/3d/world/structureGroundingPolicy.js';

function expectPolicy(label, metadata, expectedProfile, fallback = null) {
  assert.equal(resolveStructureSurfaceProfile(metadata, fallback), expectedProfile, `${label}: classifier profile`);
  const policy = resolveWorldSurfacePolicy(metadata, null, fallback);
  const preset = WORLD_SURFACE_POLICY_PRESETS[expectedProfile];
  assert.deepEqual(policy, {
    minSlopeDegrees: null,
    maxSlopeDegrees: preset.maxSlopeDegrees ?? null,
    minWaterDepth: null,
    maxWaterDepth: preset.maxWaterDepth ?? null,
    minRoadDistance: preset.minRoadDistance ?? null,
    maxRoadDistance: null,
    minSettlementDistance: null,
    maxSettlementDistance: null,
    minMoisture: null,
    maxMoisture: null,
    allowedBiomes: [],
    forbiddenBiomes: [],
    allowedWaterTypes: [],
    forbiddenWaterTypes: [],
  }, `${label}: runtime preset must match shared structure profile`);
  return policy;
}

function makeStructure(userData = {}) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(8, 5, 10), new THREE.MeshBasicMaterial());
  mesh.geometry.translate(0, 2.5, 0);
  mesh.position.set(20, 50, -10);
  mesh.rotation.y = Math.PI / 8;
  mesh.userData = { ...userData };
  mesh.updateMatrixWorld(true);
  return mesh;
}

function runPlacement({ metadata = {}, userData = {}, slopeDegrees, waterDepth }) {
  const object = makeStructure(userData);
  let queries = 0;
  const result = resolveWorldSurfacePlacement(object, {
    metadata,
    surfaceQuery(x, z) {
      queries += 1;
      return {
        height: 12 + x * 0.01 - z * 0.005,
        slopeDegrees,
        waterDepth,
        roadDistance: 8,
        biome: waterDepth > 0.02 ? 'coast' : 'settlement',
        waterType: waterDepth > 0.02 ? 'sea' : null,
      };
    },
    requireSurfaceContext: true,
    footprintGrounding: 'auto',
  });
  return { result, queries };
}

assert(Object.isFrozen(WORLD_SURFACE_POLICY_PRESETS.waterside), 'waterside preset must be immutable');
assert.equal(WORLD_SURFACE_POLICY_PRESETS.waterside.maxSlopeDegrees, 18);
assert.equal(WORLD_SURFACE_POLICY_PRESETS.waterside.maxWaterDepth, Infinity);
assert.equal(WORLD_SURFACE_POLICY_PRESETS.waterside.minRoadDistance, 0);

const palacePolicy = expectPolicy('palace', { category: 'palace' }, 'building');
const templePolicy = expectPolicy('localized temple', { category: 'Tapınak' }, 'building');
const fallbackBuildingPolicy = expectPolicy('rehydrated hall', {}, 'building', {
  structureLike: true,
  name: 'Custom Great Hall',
  category: 'custom-import',
});
for (const policy of [palacePolicy, templePolicy, fallbackBuildingPolicy]) {
  assert.equal(evaluateWorldSurfacePlacement({ height: 30, slopeDegrees: 4, waterDepth: 0, roadDistance: 4 }, policy).ok, true);
  assert(evaluateWorldSurfacePlacement({ height: 30, slopeDegrees: 19, waterDepth: 0, roadDistance: 4 }, policy).errors.includes('slope-too-steep'));
  assert(evaluateWorldSurfacePlacement({ height: 0, slopeDegrees: 2, waterDepth: 0.5, roadDistance: 4 }, policy).errors.includes('water-too-deep'));
}

const bridgePolicy = expectPolicy('aqueduct', { category: 'aqueduct' }, 'bridge');
assert.equal(evaluateWorldSurfacePlacement({ height: 2, slopeDegrees: 20, waterDepth: 7 }, bridgePolicy).ok, true,
  'bridge/aqueduct profile must allow spanning meaningful water depth');
assert(evaluateWorldSurfacePlacement({ height: 2, slopeDegrees: 31, waterDepth: 7 }, bridgePolicy).errors.includes('slope-too-steep'));

for (const [label, metadata] of [
  ['dock', { category: 'dock' }],
  ['pier', { category: 'pier' }],
  ['localized pier', { name: 'Balıkçı İskelesi', category: 'Prop' }],
  ['shipyard', { category: 'Tersane' }],
  ['lighthouse', { category: 'lighthouse' }],
]) {
  const policy = expectPolicy(label, metadata, 'waterside');
  assert.equal(evaluateWorldSurfacePlacement({ height: 1, slopeDegrees: 12, waterDepth: 5, roadDistance: 0 }, policy).ok, true,
    `${label}: waterside profile must permit authored water-spanning footprint samples`);
  assert(evaluateWorldSurfacePlacement({ height: 1, slopeDegrees: 23, waterDepth: 1, roadDistance: 0 }, policy).errors.includes('slope-too-steep'),
    `${label}: waterside structures must still reject implausibly steep foundation terrain`);
}

const dryPalace = runPlacement({ metadata: { category: 'palace' }, slopeDegrees: 6, waterDepth: 0 });
assert.equal(dryPalace.result.ok, true, dryPalace.result.error);
assert.equal(dryPalace.queries, 9, 'valid palace must evaluate its complete footprint');
assert.equal(dryPalace.result.footprint?.samples?.length, 9);

const cliffPalace = runPlacement({ metadata: { category: 'palace' }, slopeDegrees: 20, waterDepth: 0 });
assert.equal(cliffPalace.result.ok, false, 'broad dry structure must not silently accept cliff placement');
assert.match(cliffPalace.result.error, /slope-too-steep/);
assert(cliffPalace.queries >= 1 && cliffPalace.queries < 9,
  'invalid footprint should fail closed as soon as a sampled foundation point violates policy');

const submergedPalace = runPlacement({ metadata: { category: 'Saray' }, slopeDegrees: 3, waterDepth: 0.8 });
assert.equal(submergedPalace.result.ok, false, 'localized dry structure must not silently accept submerged placement');
assert.match(submergedPalace.result.error, /water-too-deep/);

const watersideRuntime = runPlacement({
  metadata: { category: 'Prop' },
  userData: { name: 'Balıkçı İskelesi', category: 'Prop' },
  slopeDegrees: 10,
  waterDepth: 4,
});
assert.equal(watersideRuntime.result.ok, true, watersideRuntime.result.error);
assert.equal(watersideRuntime.queries, 9, 'rehydrated waterside structures must evaluate their full footprint in water');
assert.equal(watersideRuntime.result.policy.maxSlopeDegrees, 18);
assert.equal(watersideRuntime.result.policy.maxWaterDepth, Infinity);

const optedOutPolicy = resolveWorldSurfacePolicy(
  { structureLike: false, category: 'Prop' },
  null,
  { structureLike: true, category: 'castle' },
);
assert.equal(optedOutPolicy.maxSlopeDegrees, null, 'primary structure opt-out must suppress fallback structure preset inference');
assert.equal(optedOutPolicy.maxWaterDepth, null);

const protectedTreePolicy = resolveWorldSurfacePolicy(
  { primitive: 'tree', category: 'Prop', structureLike: true },
  null,
  { category: 'castle' },
);
assert.equal(protectedTreePolicy.maxSlopeDegrees, null,
  'protected primitives must not inherit a structure surface preset through fallback metadata');

console.log(JSON.stringify({
  dryStructureProfile: 'building',
  bridgeProfile: 'bridge',
  watersideProfile: 'waterside',
  watersideMaxSlopeDegrees: WORLD_SURFACE_POLICY_PRESETS.waterside.maxSlopeDegrees,
  runtimeFootprintPolicyEnforced: true,
  fallbackUserDataPolicy: true,
  primaryOptOutWins: true,
}, null, 2));
