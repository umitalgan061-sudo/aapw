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
assert.equal(metrics.baseCells, 96);
assert.equal(metrics.waterCells, 95, 'G26 canonical water-centre inventory changed');
assert.equal(metrics.landCells, 1, 'G26 canonical land-centre inventory changed');
assert.equal(metrics.boundaryEdges, 4, 'G26 canonical coastline topology changed');
assert.equal(metrics.centreMismatches, 0, 'canonical mask-cell centre semantics must remain exact');
assert.equal(metrics.refinedSamples, 1617);
assert.equal(metrics.hardCellMaxStep, 1);
assert.ok(metrics.fractionalSamples > 0, 'mixed G26 must produce fractional coastline samples');
assert.ok(metrics.maxAdjacentStep > 0 && metrics.maxAdjacentStep < 1, 'refined coastline step must be continuous');

const rerun = measureG26Hydrology();
assert.deepEqual(rerun, metrics, 'G26 evidence must be deterministic across repeated evaluation');

console.log(JSON.stringify(metrics, null, 2));
console.log('SW_G26_HYDROLOGY_DIAGNOSTIC_OK');
