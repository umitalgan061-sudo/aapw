import assert from 'node:assert/strict';
import { G15_HYDROLOGY_POLICY, isInsideG15, measureG15Hydrology, sampleG15WaterConfidence } from '../godot/terrain-authoring/geocells/sw/g15_hydrology.mjs';

assert.equal(G15_HYDROLOGY_POLICY.geoCell, 'G15');
assert.deepEqual(G15_HYDROLOGY_POLICY.pixelBounds, { xMin: 192, xMax: 384, yMin: 640, yMax: 768 });
assert.deepEqual(G15_HYDROLOGY_POLICY.maskBounds, { xMin: 12, xMax: 23, yMin: 40, yMax: 47 });
assert.equal(G15_HYDROLOGY_POLICY.sourceMapSha256, '20702972e8f45f0fbdc4da5fa68e890a82e4e822e1d58e2f369d8bc5b9c571a1');
assert.equal(isInsideG15(0.125, 0.625), true);
assert.equal(isInsideG15(0.25, 0.75), true);
assert.equal(isInsideG15(0.2501, 0.7), false);
assert.equal(sampleG15WaterConfidence(0.5, 0.7), null);
assert.throws(() => sampleG15WaterConfidence(Number.NaN, 0.7), TypeError);

const metrics = measureG15Hydrology();
assert.deepEqual(metrics, {
  policyId: 'gunbatimi-ustasi-g15-hydrology-2026-08-12-v1',
  geoCell: 'G15',
  baseCells: 96,
  waterCells: 65,
  landCells: 31,
  boundaryEdges: 18,
  centreMismatches: 0,
  refinedSamples: 1617,
  fractionalSamples: 256,
  hardCellMaxStep: 1,
  maxAdjacentStep: 0.25,
  confidenceChecksum: 2027248322,
});
assert.deepEqual(measureG15Hydrology(), metrics, 'G15 evidence must be deterministic across repeated evaluation');
console.log(JSON.stringify(metrics, null, 2));
console.log('SW_G15_HYDROLOGY_VALIDATION_OK');
