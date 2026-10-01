import assert from 'node:assert/strict';
import {
  probeTerrainVisualParity,
  serializeTerrainVisualParity,
} from '../src/3d/world/terrainVisualParityProbe.js';

const samples = [
  { point: { x: 2, y: 0, z: 1 }, canonicalHeight: 10, renderedHeight: 10.02, colliderHeight: 10.01, slope: 0.3, water: 0 },
  { point: { x: 1, y: 0, z: 4 }, canonicalHeight: 4, renderedHeight: 4.01, colliderHeight: 4.02, slope: 0.92, water: 0 },
  { point: { x: 3, y: 0, z: 2 }, canonicalHeight: 2, renderedHeight: 2.01, colliderHeight: 2.02, slope: 0.25, water: 0.9 },
];

const first = probeTerrainVisualParity({ samples });
const second = probeTerrainVisualParity({ samples: [...samples].reverse() });
assert.deepEqual(first, second, 'sample ordering must be deterministic');
assert.equal(first.risk, 'clear');
assert.equal(first.acceptance.visibleTerrainMismatch, true);
assert.equal(first.acceptance.shorelineParity, true);
assert.equal(first.acceptance.steepReliefParity, true);
assert.equal(Object.isFrozen(first), true);
assert.equal(Object.isFrozen(first.samples), true);
assert.equal(typeof serializeTerrainVisualParity(first), 'string');

const mismatch = probeTerrainVisualParity({
  tolerance: 0.05,
  samples: [{
    point: { x: 0, y: 0, z: 0 },
    canonicalHeight: 20,
    renderedHeight: 20.4,
    colliderHeight: 20.1,
    slope: 0.94,
    water: 0.88,
  }],
});
assert.equal(mismatch.risk, 'guarded');
assert.equal(mismatch.mismatchCount, 1);
assert.equal(mismatch.waterMismatchCount, 1);
assert.equal(mismatch.steepMismatchCount, 1);
assert.equal(mismatch.acceptance.visibleTerrainMismatch, false);

const malformed = probeTerrainVisualParity({ samples: [{ point: null, canonicalHeight: 'bad', renderedHeight: NaN, colliderHeight: Infinity }] });
assert.equal(Number.isFinite(malformed.maxRenderedError), true);
assert.equal(Number.isFinite(malformed.maxColliderError), true);
assert.equal(Number.isFinite(malformed.maxRenderColliderGap), true);

console.log('terrain visual parity probe contract: PASS');
