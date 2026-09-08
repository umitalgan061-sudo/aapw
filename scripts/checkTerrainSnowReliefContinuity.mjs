import assert from 'node:assert/strict';
import {
  TERRAIN_SNOW_RELIEF_CONTINUITY_POLICY,
  seamBlendWeight,
  blendSnowReliefSamples,
  reconcileChunkBoundarySamples,
  validateSnowReliefContinuity,
} from '../src/3d/world/terrainSnowReliefContinuity.js';

const sample = (seed = 0) => ({
  snow: 0.72 + seed * 0.01,
  packed: 0.34 + seed * 0.01,
  powder: 0.22 + seed * 0.02,
  firn: 0.31 + seed * 0.01,
  rock: 0.12 + seed * 0.01,
  scree: 0.08 + seed * 0.01,
  wetness: 0.15 + seed * 0.01,
  roughness: 0.81 + seed * 0.01,
  normal: 0.38 + seed * 0.01,
});

assert.equal(TERRAIN_SNOW_RELIEF_CONTINUITY_POLICY.visibleSeamTarget, 0);
assert.equal(seamBlendWeight(0), 1);
assert.equal(seamBlendWeight(24), 0);
assert.ok(seamBlendWeight(12) > 0 && seamBlendWeight(12) < 1);

const blended = blendSnowReliefSamples(sample(0), sample(1), 0);
assert.ok(blended.continuous);
assert.ok(blended.maxDelta <= TERRAIN_SNOW_RELIEF_CONTINUITY_POLICY.maxBlendDelta);
assert.ok(Object.values(blended).every((value) => typeof value !== 'number' || Number.isFinite(value)));

const reconciled = reconcileChunkBoundarySamples([
  { ...sample(0), distanceToSeamMeters: 0 },
  { ...sample(1), distanceToSeamMeters: 8 },
  { ...sample(2), distanceToSeamMeters: 24 },
]);
assert.ok(reconciled.accepted);
assert.ok(validateSnowReliefContinuity(reconciled));
assert.equal(reconciled.samples.length, 3);
assert.ok(reconciled.maxSeamDelta <= 0.25);

const malformed = reconcileChunkBoundarySamples(null);
assert.equal(malformed.accepted, false);
assert.deepEqual(malformed.reasons, ['empty-sample-list']);

console.log(JSON.stringify({
  policy: TERRAIN_SNOW_RELIEF_CONTINUITY_POLICY.id,
  seamWindowMeters: TERRAIN_SNOW_RELIEF_CONTINUITY_POLICY.seamWindowMeters,
  maxSeamDelta: reconciled.maxSeamDelta,
  sampleCount: reconciled.samples.length,
  status: 'PASS',
}, null, 2));
