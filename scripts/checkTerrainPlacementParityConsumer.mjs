import assert from 'node:assert/strict';
import {
  evaluatePreparedPlacementForAttach,
  assertPreparedPlacementForAttach,
} from '../src/3d/world/terrainPlacementParityConsumer.ts';

const passing = {
  surface: { x: 0, z: 0, height: 10 },
  footprint: {
    samples: [
      { x: 0, z: 0, renderedHeight: 10, colliderHeight: 10.1 },
      { x: 1, z: 0, renderedHeight: 10.2, colliderHeight: 10.25 },
      { x: 0, z: 1, renderedHeight: 10.3, colliderHeight: 10.35 },
    ],
  },
};
const decision = evaluatePreparedPlacementForAttach(passing);
assert.equal(decision.ok, true);
assert.equal(decision.failures.length, 0);
assert.equal(decision.sampleCount, 3);
assert.doesNotThrow(() => assertPreparedPlacementForAttach(passing));
assert.ok(Object.isFrozen(decision));
assert.ok(Object.isFrozen(decision.failures));

const rejected = {
  surface: { x: 0, z: 0, height: 10 },
  footprint: {
    samples: [
      { x: 0, z: 0, renderedHeight: 10, colliderHeight: 10.1 },
      { x: 1, z: 0, renderedHeight: 10.2, colliderHeight: 11.5 },
    ],
  },
};
const rejection = evaluatePreparedPlacementForAttach(rejected);
assert.equal(rejection.ok, false);
assert.deepEqual(rejection.failures, [
  'terrain-collider-parity',
  'unsafe-footprint-grade',
]);
assert.throws(
  () => assertPreparedPlacementForAttach(rejected),
  /Prepared world placement rejected: terrain-collider-parity,unsafe-footprint-grade/,
);

const malformed = {
  surface: { x: 0, z: 0, height: 10 },
  footprint: { samples: [null] },
};
const malformedDecision = evaluatePreparedPlacementForAttach(malformed);
assert.equal(malformedDecision.ok, false);
assert.deepEqual(malformedDecision.failures, ['malformed-sample']);
assert.throws(
  () => assertPreparedPlacementForAttach(malformed),
  /Prepared world placement rejected: malformed-sample/,
);

const malformedCoordinate = {
  surface: { x: 0, z: 0, height: 10 },
  footprint: {
    samples: [
      { x: Number.NaN, z: 0, renderedHeight: 10, colliderHeight: 10 },
    ],
  },
};
const malformedCoordinateDecision = evaluatePreparedPlacementForAttach(malformedCoordinate);
assert.equal(malformedCoordinateDecision.ok, false);
assert.deepEqual(malformedCoordinateDecision.failures, ['malformed-sample']);
assert.throws(
  () => assertPreparedPlacementForAttach(malformedCoordinate),
  /Prepared world placement rejected: malformed-sample/,
);

const malformedSurface = {
  surface: { x: Number.POSITIVE_INFINITY, z: 0, height: 10 },
  footprint: {
    samples: [
      { x: 0, z: 0, renderedHeight: 10, colliderHeight: 10.1 },
    ],
  },
};
const malformedSurfaceDecision = evaluatePreparedPlacementForAttach(malformedSurface);
assert.equal(malformedSurfaceDecision.ok, false);
assert.deepEqual(malformedSurfaceDecision.failures, ['malformed-sample']);
assert.throws(
  () => assertPreparedPlacementForAttach(malformedSurface),
  /Prepared world placement rejected: malformed-sample/,
);

console.log('Terrain placement parity consumer PASS');