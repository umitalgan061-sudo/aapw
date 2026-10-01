import assert from 'node:assert/strict';
import { createTerrainPbrSignalRouter, validateTerrainPbrSignal } from '../src/3d/world/terrainPbrSignalRouter.js';

const router = createTerrainPbrSignalRouter({ seedSalt: 23 });
const sample = {
  x: 1834.25,
  z: -927.5,
  height: 312,
  slope: 0.61,
  moisture: 0.48,
  temperature: 0.31,
  waterDistance: 0.42,
  biome: 'alpine',
  seed: 9182,
  cameraDistance: 24,
  canonical: true,
};

const a = router.sample(sample);
const b = router.sample(sample);
assert.deepEqual(a, b, 'same canonical sample must be deterministic');
assert.equal(a.accepted, true);
assert.equal(validateTerrainPbrSignal(a).valid, true);
assert.equal(a.invariants.canonicalHeightMutated, false);
assert.equal(a.invariants.canonicalHydrologyMutated, false);
assert.equal(a.invariants.canonicalPlacementMutated, false);
assert.ok(a.weights.snow > 0 || a.weights.rock > 0, 'alpine context should expose relief material response');
assert.ok(a.weights.shoreline > 0, 'near-water context should expose shoreline response');
assert.ok(a.pbr.normalStrength > 0, 'near camera should retain micro normal response');

const far = router.sample({ ...sample, cameraDistance: 1000 });
assert.ok(far.pbr.normalStrength < a.pbr.normalStrength, 'far camera must fade micro-normal energy');
assert.ok(Math.abs(Object.values(far.weights).reduce((sum, value) => sum + value, 0) - 1) < 1e-6);

const malformed = router.sample({ ...sample, x: Number.NaN, slope: Number.POSITIVE_INFINITY, canonical: false });
assert.equal(malformed.accepted, false);
assert.equal(validateTerrainPbrSignal(malformed).valid, false);
assert.ok(Object.values(malformed.weights).every(Number.isFinite));
assert.ok(Object.values(malformed.pbr).every(Number.isFinite));

console.log('TERRAIN_PBR_SIGNAL_ROUTER_OK');
