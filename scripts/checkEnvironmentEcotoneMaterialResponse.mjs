import assert from 'node:assert/strict';
import {
  ENVIRONMENT_ECOTONE_MATERIAL_POLICY,
  applyEnvironmentEcotoneMaterialResponse,
  buildEnvironmentEcotoneMaterialResponse,
  serializeEnvironmentEcotoneMaterialResponse,
  validateEnvironmentEcotoneMaterialResponse,
} from '../src/3d/world/environmentEcotoneMaterialResponse.js';

const sample = {
  worldX: 120,
  worldY: 18,
  worldZ: -80,
  heightAboveSeaMeters: 18,
  slopeDegrees: 31,
  moisture: 0.72,
  snow: 0.28,
  rock: 0.42,
  grass: 0.86,
  forest: 0.64,
  waterDistanceMeters: 18,
  roadDistanceMeters: 9,
  settlementDistanceMeters: 25,
  biomeName: 'alpine foothill',
  canonicalConfidence: 1,
};

const first = buildEnvironmentEcotoneMaterialResponse(sample);
const second = buildEnvironmentEcotoneMaterialResponse(sample);
assert.deepEqual(first, second);
assert.equal(first.policy, ENVIRONMENT_ECOTONE_MATERIAL_POLICY.id);
assert.equal(validateEnvironmentEcotoneMaterialResponse(first).pass, true);
assert.equal(first.acceptance.visibleRectangularWater, 0);
assert.equal(first.acceptance.visibleWaterMoire, 0);
assert.equal(first.acceptance.visibleTextureTiling, 0);
assert.equal(Object.isFrozen(first), true);
assert.equal(Object.isFrozen(first.surfaces), true);
assert.equal(typeof first.digest, 'string');
assert.equal(serializeEnvironmentEcotoneMaterialResponse(first), serializeEnvironmentEcotoneMaterialResponse(second));

const water = buildEnvironmentEcotoneMaterialResponse({
  heightAboveSeaMeters: -2,
  slopeDegrees: 4,
  moisture: 0.9,
  waterDistanceMeters: 0.5,
});
assert.equal(water.vegetation.valid, false);
assert.equal(water.vegetation.reason, 'water');
assert.equal(water.acceptance.invalidVegetationPlacement, 1);

const cliff = buildEnvironmentEcotoneMaterialResponse({
  heightAboveSeaMeters: 130,
  slopeDegrees: 58,
  snow: 0.2,
  rock: 0.8,
  waterDistanceMeters: 60,
});
assert.equal(cliff.vegetation.valid, false);
assert.equal(cliff.vegetation.reason, 'cliff');
assert.ok(cliff.surfaces.scree > 0);

const malformed = buildEnvironmentEcotoneMaterialResponse({
  worldX: NaN,
  heightAboveSeaMeters: Infinity,
  slopeDegrees: -Infinity,
  moisture: 'bad',
  snow: null,
  rock: undefined,
  waterDistanceMeters: NaN,
});
assert.equal(validateEnvironmentEcotoneMaterialResponse(malformed).pass, true);

const applied = applyEnvironmentEcotoneMaterialResponse(
  { roughness: 0.8, normalScale: 1, userData: { existing: true } },
  first,
);
assert.ok(applied.roughness >= 0.05 && applied.roughness <= 1);
assert.ok(applied.normalScale >= 0 && applied.normalScale <= 1.5);
assert.equal(applied.userData.existing, true);
assert.equal(applied.userData.environmentEcotoneMaterialResponse.digest, first.digest);

console.log('[checkEnvironmentEcotoneMaterialResponse] PASS');
