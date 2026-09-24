import assert from 'node:assert/strict';
import {
  TERRAIN_PLACEMENT_PARITY_DEFAULTS,
  evaluateTerrainPlacementParity,
  assertTerrainPlacementParity,
} from '../src/3d/world/terrainPlacementParity.ts';
import {
  collectTerrainParitySamples,
  evaluatePreparedPlacementParity,
} from '../src/3d/world/terrainPlacementParityBridge.ts';

const passing = [
  { x: 0, z: 0, renderedHeight: 10, colliderHeight: 10.1 },
  { x: 1, z: 0, renderedHeight: 10.4, colliderHeight: 10.55 },
  { x: 0, z: 1, renderedHeight: 10.8, colliderHeight: 10.9 },
];
const pass = evaluateTerrainPlacementParity(passing);
assert.equal(pass.ok, true);
assert.equal(pass.failures.length, 0);
assert.equal(pass.sampleCount, 3);
assert.ok(pass.maxHeightDeltaMeters <= TERRAIN_PLACEMENT_PARITY_DEFAULTS.maxHeightDeltaMeters);
assert.doesNotThrow(() => assertTerrainPlacementParity(passing));

const parityFailure = evaluateTerrainPlacementParity([
  { x: 0, z: 0, renderedHeight: 10, colliderHeight: 10.4 },
]);
assert.equal(parityFailure.ok, false);
assert.deepEqual(parityFailure.failures, ['terrain-collider-parity']);

const gradeFailure = evaluateTerrainPlacementParity([
  { x: 0, z: 0, renderedHeight: 0, colliderHeight: 0 },
  { x: 1, z: 0, renderedHeight: 2, colliderHeight: 2 },
]);
assert.equal(gradeFailure.ok, false);
assert.deepEqual(gradeFailure.failures, ['unsafe-footprint-grade']);

const colliderOnlyGradeFailure = evaluateTerrainPlacementParity([
  { x: 0, z: 0, renderedHeight: 10, colliderHeight: 10.1 },
  { x: 1, z: 0, renderedHeight: 10.2, colliderHeight: 11.5 },
]);
assert.equal(colliderOnlyGradeFailure.ok, false);
assert.deepEqual(colliderOnlyGradeFailure.failures, [
  'terrain-collider-parity',
  'unsafe-footprint-grade',
]);
assert.equal(colliderOnlyGradeFailure.maxFootprintRangeMeters, 1.5);

const mixedFailureOrder = evaluateTerrainPlacementParity([
  { x: 0, z: 0, renderedHeight: 0, colliderHeight: 2 },
  { x: Number.NaN, z: 0, renderedHeight: 10, colliderHeight: 10 },
  null,
  { x: 1, z: 0, renderedHeight: 2, colliderHeight: 2 },
]);
assert.deepEqual(mixedFailureOrder.failures, [
  'invalid-sample',
  'invalid-coordinate',
  'terrain-collider-parity',
  'unsafe-footprint-grade',
]);

const malformed = evaluateTerrainPlacementParity([
  { x: 0, z: 0, renderedHeight: Number.NaN, colliderHeight: 1 },
]);
assert.equal(malformed.ok, false);
assert.deepEqual(malformed.failures, ['non-finite-sample']);

const malformedCoordinate = evaluateTerrainPlacementParity([
  { x: Number.NaN, z: 0, renderedHeight: 10, colliderHeight: 10 },
]);
assert.equal(malformedCoordinate.ok, false);
assert.deepEqual(malformedCoordinate.failures, ['invalid-coordinate']);

const malformedShape = evaluateTerrainPlacementParity([null]);
assert.equal(malformedShape.ok, false);
assert.deepEqual(malformedShape.failures, ['invalid-sample']);

assert.throws(() => assertTerrainPlacementParity(gradeFailure.sampleCount ? [
  { x: 0, z: 0, renderedHeight: 0, colliderHeight: 0 },
  { x: 1, z: 0, renderedHeight: 2, colliderHeight: 2 },
] : []), /unsafe-footprint-grade/);

const bridged = collectTerrainParitySamples(
  { x: 0, z: 0, height: 10, colliderHeight: 10.1 },
  {
    samples: [
      null,
      { x: Number.NaN, z: 0, renderedHeight: 10, colliderHeight: 10 },
      { x: 0, z: 0, renderedHeight: 10, colliderHeight: 10.1 },
      { x: 1, z: 0, renderedHeight: 10.2, colliderHeight: 10.25 },
      { x: 1, z: 0, renderedHeight: 99, colliderHeight: 99 },
    ],
  },
);
assert.equal(bridged.length, 4);
assert.equal(bridged[0], null);
assert.equal(bridged[1], null);
assert.equal(bridged[2].renderedHeight, 10);
assert.equal(bridged[3].renderedHeight, 10.2);
assert.equal(evaluatePreparedPlacementParity(
  { x: 0, z: 0, height: 10, colliderHeight: 10.1 },
  { samples: [{ x: 1, z: 0, renderedHeight: 10.2, colliderHeight: 10.25 }] },
).ok, true);
assert.equal(evaluatePreparedPlacementParity(
  null,
  { samples: [null] },
).ok, false);

console.log('Terrain placement parity contract PASS');
