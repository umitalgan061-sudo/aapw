import assert from 'node:assert/strict';
import { G25_HYDROLOGY_POLICY, isInsideG25, measureG25Hydrology, sampleG25WaterConfidence } from '../godot/terrain-authoring/geocells/sw/g25_hydrology.mjs';

assert.equal(G25_HYDROLOGY_POLICY.geoCell, 'G25');
assert.deepEqual(G25_HYDROLOGY_POLICY.pixelBounds, { xMin: 384, xMax: 576, yMin: 640, yMax: 768 });
assert.deepEqual(G25_HYDROLOGY_POLICY.maskBounds, { xMin: 24, xMax: 35, yMin: 40, yMax: 47 });
assert.equal(G25_HYDROLOGY_POLICY.sourceMapSha256, '20702972e8f45f0fbdc4da5fa68e890a82e4e822e1d58e2f369d8bc5b9c571a1');
assert.equal(isInsideG25(0.25, 0.625), true);
assert.equal(isInsideG25(0.375, 0.75), true);
assert.equal(isInsideG25(0.2499, 0.7), false);
assert.equal(sampleG25WaterConfidence(0, 0), null);
assert.throws(() => sampleG25WaterConfidence(Number.NaN, 0.7), TypeError);

const metrics = measureG25Hydrology();
assert.deepEqual(metrics, {
  policyId: 'gunbatimi-ustasi-g25-hydrology-2026-08-12-v1',
  geoCell: 'G25',
  baseCells: 96,
  waterCells: 77,
  landCells: 19,
  boundaryEdges: 12,
  centreMismatches: 0,
  refinedSamples: 1617,
  fractionalSamples: 185,
  hardCellMaxStep: 1,
  maxAdjacentStep: 0.25,
  confidenceChecksum: 2090753397,
});
assert.deepEqual(measureG25Hydrology(), metrics, 'G25 evidence must be deterministic');
console.log(JSON.stringify(metrics, null, 2));
console.log('SW_G25_HYDROLOGY_VALIDATION_OK');
