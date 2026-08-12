import assert from 'node:assert/strict';
import { G05_HYDROLOGY_POLICY, isInsideG05, measureG05Hydrology, sampleG05WaterConfidence } from '../godot/terrain-authoring/geocells/sw/g05_hydrology.mjs';

assert.equal(G05_HYDROLOGY_POLICY.geoCell, 'G05');
assert.deepEqual(G05_HYDROLOGY_POLICY.pixelBounds, { xMin: 0, xMax: 192, yMin: 640, yMax: 768 });
assert.deepEqual(G05_HYDROLOGY_POLICY.maskBounds, { xMin: 0, xMax: 11, yMin: 40, yMax: 47 });
assert.equal(G05_HYDROLOGY_POLICY.sourceMapSha256, '20702972e8f45f0fbdc4da5fa68e890a82e4e822e1d58e2f369d8bc5b9c571a1');
assert.equal(isInsideG05(0, 0.625), true);
assert.equal(isInsideG05(0.125, 0.75), true);
assert.equal(isInsideG05(0.1251, 0.7), false);
assert.equal(sampleG05WaterConfidence(0.5, 0.7), null);
assert.throws(() => sampleG05WaterConfidence(Number.NaN, 0.7), TypeError);

const metrics = measureG05Hydrology();
assert.deepEqual(metrics, {
  policyId: 'gunbatimi-ustasi-g05-hydrology-2026-08-12-v1',
  geoCell: 'G05',
  baseCells: 96,
  waterCells: 90,
  landCells: 6,
  boundaryEdges: 5,
  centreMismatches: 0,
  refinedSamples: 1617,
  fractionalSamples: 79,
  hardCellMaxStep: 1,
  maxAdjacentStep: 0.25,
  confidenceChecksum: 873751090,
});
assert.deepEqual(measureG05Hydrology(), metrics, 'G05 evidence must be deterministic across repeated evaluation');
console.log(JSON.stringify(metrics, null, 2));
console.log('SW_G05_HYDROLOGY_VALIDATION_OK');
