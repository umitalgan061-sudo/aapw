import assert from 'node:assert/strict';
import {
  G16_HYDROLOGY_POLICY,
  isInsideG16,
  measureG16Hydrology,
  sampleG16WaterConfidence,
} from '../godot/terrain-authoring/geocells/sw/g16_hydrology.mjs';

assert.equal(G16_HYDROLOGY_POLICY.geoCell, 'G16');
assert.deepEqual(G16_HYDROLOGY_POLICY.pixelBounds, { xMin: 192, xMax: 384, yMin: 768, yMax: 896 });
assert.deepEqual(G16_HYDROLOGY_POLICY.maskBounds, { xMin: 12, xMax: 23, yMin: 48, yMax: 55 });
assert.equal(G16_HYDROLOGY_POLICY.sourceMapSha256, '20702972e8f45f0fbdc4da5fa68e890a82e4e822e1d58e2f369d8bc5b9c571a1');
assert.equal(isInsideG16(0.125, 0.75), true);
assert.equal(isInsideG16(0.25, 0.875), true);
assert.equal(isInsideG16(0.1249, 0.8), false);
assert.equal(isInsideG16(0.2, 0.8751), false);
assert.equal(sampleG16WaterConfidence(0, 0), null);
assert.throws(() => sampleG16WaterConfidence(Number.NaN, 0.8), TypeError);

const metrics = measureG16Hydrology();
assert.equal(metrics.baseCells, 96);
assert.equal(metrics.waterCells, 95, 'G16 must retain the canonical 95-water centre count');
assert.equal(metrics.landCells, 1, 'G16 must retain the canonical 1-land centre count');
assert.ok(metrics.boundaryEdges > 0, 'G16 must contain an actual land/water transition');
assert.equal(metrics.centreMismatches, 0, 'canonical mask-cell centre semantics must remain exact');
assert.ok(metrics.fractionalSamples > 0, 'real coastline refinement must produce fractional confidence samples');
assert.ok(metrics.maxAdjacentStep > 0, 'G16 must contain a measurable transition');
assert.ok(metrics.maxAdjacentStep < metrics.hardCellMaxStep, 'bilinear refinement must reduce the hard-cell discontinuity');
assert.ok(Number.isInteger(metrics.confidenceChecksum));

const rerun = measureG16Hydrology();
assert.deepEqual(rerun, metrics, 'G16 evidence must be deterministic across repeated evaluation');

console.log(JSON.stringify(metrics, null, 2));
console.log('SW_G16_HYDROLOGY_VALIDATION_OK');
