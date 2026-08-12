import assert from 'node:assert/strict';
import {
  G26_HYDROLOGY_POLICY,
  isInsideG26,
  measureG26Hydrology,
  sampleG26WaterConfidence,
} from '../godot/terrain-authoring/geocells/sw/g26_hydrology.mjs';

assert.equal(G26_HYDROLOGY_POLICY.geoCell, 'G26');
assert.deepEqual(G26_HYDROLOGY_POLICY.pixelBounds, { xMin: 384, xMax: 576, yMin: 768, yMax: 896 });
assert.deepEqual(G26_HYDROLOGY_POLICY.maskBounds, { xMin: 24, xMax: 35, yMin: 48, yMax: 55 });
assert.equal(G26_HYDROLOGY_POLICY.sourceMapSha256, '20702972e8f45f0fbdc4da5fa68e890a82e4e822e1d58e2f369d8bc5b9c571a1');
assert.equal(isInsideG26(0.25, 0.75), true);
assert.equal(isInsideG26(0.375, 0.875), true);
assert.equal(isInsideG26(0.2499, 0.8), false);
assert.equal(isInsideG26(0.3, 0.8751), false);
assert.equal(sampleG26WaterConfidence(0, 0), null);
assert.throws(() => sampleG26WaterConfidence(Number.NaN, 0.8), TypeError);

const metrics = measureG26Hydrology();
assert.deepEqual(metrics, {
  policyId: 'gunbatimi-ustasi-g26-hydrology-2026-08-12-v1',
  geoCell: 'G26',
  baseCells: 96,
  waterCells: 95,
  landCells: 1,
  boundaryEdges: 4,
  centreMismatches: 0,
  refinedSamples: 1617,
  fractionalSamples: 48,
  hardCellMaxStep: 1,
  maxAdjacentStep: 0.25,
  confidenceChecksum: 2944676031,
});

const rerun = measureG26Hydrology();
assert.deepEqual(rerun, metrics, 'G26 evidence must be deterministic across repeated evaluation');

console.log(JSON.stringify(metrics, null, 2));
console.log('SW_G26_HYDROLOGY_VALIDATION_OK');
