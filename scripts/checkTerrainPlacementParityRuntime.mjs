import assert from 'node:assert/strict';
import {
  collectPreparedPlacementParitySamples,
  evaluatePreparedWorldPlacementParity,
  assertPreparedWorldPlacementParity,
} from '../src/3d/world/terrainPlacementParityRuntime.ts';

const prepared = {
  surface: { x: 0, z: 0, height: 10 },
  footprint: {
    samples: [
      { x: 0, z: 0, renderedHeight: 10, colliderHeight: 10.1 },
      { x: 1, z: 0, renderedHeight: 10.2, colliderHeight: 10.25 },
    ],
    islandSamples: [
      { x: 0, z: 0, renderedHeight: 99, colliderHeight: 99 },
      { x: 0, z: 1, renderedHeight: 10.3, colliderHeight: 10.35 },
    ],
  },
};

const samples = collectPreparedPlacementParitySamples(prepared);
assert.equal(samples.length, 3);
assert.deepEqual(samples.map(({ x, z }) => `${x}:${z}`), ['0:0', '1:0', '0:1']);

const pass = evaluatePreparedWorldPlacementParity(prepared);
assert.equal(pass.ok, true);
assert.equal(pass.failures.length, 0);
assert.doesNotThrow(() => assertPreparedWorldPlacementParity(prepared));

const failure = evaluatePreparedWorldPlacementParity({
  surface: { x: 0, z: 0, height: 10 },
  footprint: { samples: [{ x: 0, z: 0, renderedHeight: 10, colliderHeight: 10.4 }] },
});
assert.equal(failure.ok, false);
assert.deepEqual(failure.failures, ['terrain-collider-parity']);
assert.throws(
  () => assertPreparedWorldPlacementParity({
    surface: { x: 0, z: 0, height: 10 },
    footprint: { samples: [{ x: 0, z: 0, renderedHeight: 10, colliderHeight: 10.4 }] },
  }),
  /terrain-collider-parity/,
);

const nonFinite = collectPreparedPlacementParitySamples({
  footprint: {
    samples: [
      { x: Number.NaN, z: 0, renderedHeight: 10, colliderHeight: 10 },
      { x: 0, z: 0, renderedHeight: 10, colliderHeight: 10 },
      { x: 0, z: 0, renderedHeight: Number.POSITIVE_INFINITY, colliderHeight: 10 },
    ],
  },
});
assert.equal(nonFinite.length, 3);
assert.equal(nonFinite.filter((sample) => sample === null).length, 2);
assert.deepEqual(nonFinite[2], { x: 0, z: 0, renderedHeight: 10, colliderHeight: 10 });
const nonFiniteDecision = evaluatePreparedWorldPlacementParity({
  footprint: {
    samples: [{ x: Number.NaN, z: 0, renderedHeight: 10, colliderHeight: 10 }],
  },
});
assert.equal(nonFiniteDecision.ok, false);
assert.ok(nonFiniteDecision.failures.includes('malformed-sample'));

console.log('Terrain placement parity runtime adapter PASS');
