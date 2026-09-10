import assert from 'node:assert/strict';
import {
  ENVIRONMENT_RUNTIME_BRIDGE_V59,
  buildEnvironmentRuntimeBridge,
  getEnvironmentRuntimeBridgeCapabilities,
  normalizeEnvironmentSample,
  serializeEnvironmentRuntimeBridge,
} from '../src/3d/world/environmentRuntimeBridgeV59.js';

const sample = {
  x: 120,
  y: 18,
  z: -80,
  slopeDegrees: 34,
  heightAboveSeaMeters: 145,
  moisture: 0.72,
  snowAmount: 0.18,
  waterDistanceMeters: 12,
  waterDepthMeters: 2,
  waterClass: 'river',
  assetReady: true,
  grounded: true,
  roadDistanceMeters: 8,
  settlementDistanceMeters: 20,
  biome: { grass: 0.84, forest: 0.58, rock: 0.22, snow: 0.18 },
  distanceMeters: 90,
};

const first = normalizeEnvironmentSample(sample);
const second = normalizeEnvironmentSample({ ...sample });
assert.deepEqual(first, second, 'normalization must be deterministic');
assert.equal(first.placement.eligible, true, 'grounded safe sample should remain eligible');
assert.equal(first.render.terrain.triplanarEquivalent, true, 'steep sample should request triplanar-equivalent shading');
assert.ok(first.ecotone.snowlineEdge >= 0 && first.ecotone.snowlineEdge <= 1);
assert.ok(first.render.water.foamStrength > 0, 'shore-adjacent river should emit bounded foam intent');
assert.equal(first.vegetation.instancing, false, 'near samples must keep caller-owned near detail');

const blocked = normalizeEnvironmentSample({ ...sample, waterDistanceMeters: 1 });
assert.equal(blocked.placement.eligible, false);
assert.ok(blocked.placement.exclusionReasons.includes('too-close-to-water'));
assert.equal(blocked.vegetation.cleared, true);

const malformed = normalizeEnvironmentSample({ slopeDegrees: 'bad', heightAboveSeaMeters: NaN, biome: null, waterDistanceMeters: Infinity });
assert.ok(Number.isFinite(malformed.surface.slopeDegrees));
assert.ok(Number.isFinite(malformed.surface.heightAboveSeaMeters));
assert.equal(malformed.water.waterDistanceMeters, 1e9);

const plan = buildEnvironmentRuntimeBridge([sample, { ...sample, distanceMeters: 900 }, { ...sample, distanceMeters: 5000 }]);
assert.deepEqual(plan.counts, { near: 1, mid: 1, far: 0, impostor: 1, placementEligible: 3, waterSamples: 3 });
assert.equal(plan.acceptance.width, 1536);
assert.equal(plan.acceptance.height, 1024);
assert.equal(plan.acceptance.actualCreateSceneRequired, true);
assert.equal(plan.riskCounts.rectangularWater, 0);
assert.equal(plan.riskCounts.waterMoire, 0);
assert.equal(plan.riskCounts.blackSky, 0);
assert.equal(Object.isFrozen(plan), true);
assert.equal(Object.isFrozen(plan.samples), true);
assert.equal(serializeEnvironmentRuntimeBridge([sample]), serializeEnvironmentRuntimeBridge([sample]));

const capabilities = getEnvironmentRuntimeBridgeCapabilities();
assert.equal(capabilities.editorImport, false);
assert.equal(capabilities.geometryCreation, false);
assert.deepEqual(capabilities.materialPlacementSequence, [
  'asset-hydrate-load', 'surface-analysis', 'multi-material-recipe', 'validation',
  'ground-transform', 'manifest', 'scene-attach',
]);
assert.equal(ENVIRONMENT_RUNTIME_BRIDGE_V59.materialPlacementAuthority, 'merged-590');
console.info('environment runtime bridge v59 checks passed');
