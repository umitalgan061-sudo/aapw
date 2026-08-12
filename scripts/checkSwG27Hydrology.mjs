import assert from 'node:assert/strict';
import {
  G27_HYDROLOGY_POLICY,
  isInsideG27,
  measureG27Hydrology,
  sampleG27WaterConfidence,
} from '../godot/terrain-authoring/geocells/sw/g27_hydrology.mjs';

assert.equal(G27_HYDROLOGY_POLICY.geoCell, 'G27');
assert.deepEqual(G27_HYDROLOGY_POLICY.pixelBounds, { xMin: 384, xMax: 576, yMin: 896, yMax: 1024 });
assert.deepEqual(G27_HYDROLOGY_POLICY.maskBounds, { xMin: 24, xMax: 35, yMin: 56, yMax: 63 });
assert.equal(G27_HYDROLOGY_POLICY.sourceMapSha256, '20702972e8f45f0fbdc4da5fa68e890a82e4e822e1d58e2f369d8bc5b9c571a1');
assert.equal(isInsideG27(0.25, 0.875), true);
assert.equal(isInsideG27(0.375, 1.0), true);
assert.equal(isInsideG27(0.2499, 0.9), false);
assert.equal(isInsideG27(0.3, 1.0001), false);
assert.equal(sampleG27WaterConfidence(0, 0), null);
assert.throws(() => sampleG27WaterConfidence(Number.NaN, 0.9), TypeError);

const metrics = measureG27Hydrology();
assert.equal(metrics.baseCells, 96);
assert.equal(metrics.waterCells, 83, 'G27 canonical water-centre inventory changed');
assert.equal(metrics.landCells, 13, 'G27 canonical land-centre inventory changed');
assert.equal(metrics.boundaryEdges, 24, 'G27 canonical coastline topology changed');
assert.equal(metrics.centreMismatches, 0, 'canonical mask-cell centre semantics must remain exact');
assert.equal(metrics.refinedSamples, 1617);
assert.ok(metrics.fractionalSamples > 0, 'G27 coastline refinement must produce fractional confidence samples');
assert.ok(metrics.maxAdjacentStep > 0, 'G27 must contain a measurable coastline transition');
assert.ok(metrics.maxAdjacentStep < metrics.hardCellMaxStep, 'bilinear refinement must reduce the hard-cell discontinuity');
assert.ok(Number.isInteger(metrics.confidenceChecksum));

const rerun = measureG27Hydrology();
assert.deepEqual(rerun, metrics, 'G27 evidence must be deterministic across repeated evaluation');

console.log(JSON.stringify(metrics, null, 2));
console.log('SW_G27_HYDROLOGY_VALIDATION_OK');
