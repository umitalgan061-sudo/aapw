import assert from 'node:assert/strict';
import {
  WORLD_GROUND_QUERY_CONTRACT as C,
  normalizeGroundSample,
  queryGroundContext,
  queryGroundContextBatch,
  buildGroundQueryManifest,
} from '../src/3d/world/WorldGroundQueryContract.js';

const raw = {
  x: 10, z: 20, renderedHeightMeters: 14.2, canonicalHeightMeters: 14.1, colliderHeightMeters: 14.05,
  slopeDegrees: 12, moisture: 0.62, snow: 0.1, waterDepthMeters: 0, waterCoverage: 0,
  waterClass: 'none', biome: 'temperate-forest', roadDistanceMeters: 20, settlementDistanceMeters: 50,
};
const a = queryGroundContext(raw);
const b = queryGroundContext({ ...raw });
assert.deepEqual(a, b);
assert.equal(a.grounded, true);
assert.equal(a.canQueryCollider, true);
assert.equal(a.sample.surfaceBand, 'wet-lowland');

const water = queryGroundContext({ ...raw, waterClass: 'river', waterCoverage: 0.8, waterDepthMeters: 1.2 });
assert.equal(water.grounded, false);
assert.ok(water.exclusions.includes('water'));
assert.equal(water.canQueryWater, true);

const cliff = queryGroundContext({ ...raw, slopeDegrees: 61 });
assert.equal(cliff.sample.surfaceBand, 'cliff');
assert.ok(cliff.exclusions.includes('steep-slope'));

const snow = queryGroundContext({ ...raw, snow: 0.9, heightMeters: 220 });
assert.equal(snow.sample.surfaceBand, 'alpine-snow');
assert.ok(snow.exclusions.includes('permanent-snow'));

const malformed = normalizeGroundSample({ x: 'bad', slopeDegrees: 'bad', moisture: 'bad', waterDepthMeters: 'bad' });
assert.equal(Number.isFinite(malformed.x), true);
assert.equal(Number.isFinite(malformed.slopeDegrees), true);
assert.equal(Number.isFinite(malformed.waterDepthMeters), true);

const batch = queryGroundContextBatch([raw, { ...raw, roadDistanceMeters: 1 }]);
assert.equal(batch.length, 2);
const manifest = buildGroundQueryManifest([raw, water, cliff]);
assert.equal(manifest.contract.id, C.id);
assert.equal(manifest.summary.total, 3);
assert.ok(manifest.summary.exclusions.water >= 1);
assert.equal(Object.isFrozen(manifest), true);
assert.equal(Object.isFrozen(manifest.entries), true);

console.info(`[world-ground-query] PASS ${C.id}`);
