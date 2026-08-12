import assert from 'node:assert/strict';
import {
  G10_HYDROLOGY_POLICY,
  isInsideG10,
  measureG10Hydrology,
  sampleG10WaterConfidence,
} from '../godot/terrain-authoring/geocells/nw/g10_hydrology.mjs';

assert.equal(G10_HYDROLOGY_POLICY.geoCell, 'G10');
assert.deepEqual(G10_HYDROLOGY_POLICY.pixelBounds, { xMin: 192, xMax: 384, yMin: 0, yMax: 128 });
assert.deepEqual(G10_HYDROLOGY_POLICY.maskBounds, { xMin: 12, xMax: 23, yMin: 0, yMax: 7 });
assert.equal(G10_HYDROLOGY_POLICY.sourceMapSha256, '20702972e8f45f0fbdc4da5fa68e890a82e4e822e1d58e2f369d8bc5b9c571a1');
assert.equal(isInsideG10(0.125, 0), true);
assert.equal(isInsideG10(0.25, 0.125), true);
assert.equal(isInsideG10(0.1249, 0.05), false);
assert.equal(isInsideG10(0.2, 0.1251), false);
assert.equal(sampleG10WaterConfidence(0, 0), null);
assert.throws(() => sampleG10WaterConfidence(Number.NaN, 0.05), TypeError);

const metrics = measureG10Hydrology();
assert.equal(metrics.baseCells, 96);
assert.equal(metrics.waterCells, 60, 'G10 canonical water-centre inventory changed');
assert.equal(metrics.landCells, 36, 'G10 canonical land-centre inventory changed');
assert.equal(metrics.boundaryEdges, 30, 'G10 canonical coastline topology changed');
assert.equal(metrics.centreMismatches, 0, 'canonical mask-cell centre semantics must remain exact');
assert.equal(metrics.refinedSamples, 1617);
assert.equal(metrics.fractionalSamples, 393, 'G10 fractional coastline fingerprint changed');
assert.equal(metrics.hardCellMaxStep, 1);
assert.equal(metrics.maxAdjacentStep, 0.25, 'G10 bilinear transition step changed');
assert.equal(metrics.confidenceChecksum, 1257566304, 'G10 deterministic confidence checksum changed');
assert.ok(metrics.maxAdjacentStep < metrics.hardCellMaxStep, 'bilinear refinement must reduce the hard-cell discontinuity');

const rerun = measureG10Hydrology();
assert.deepEqual(rerun, metrics, 'G10 evidence must be deterministic across repeated evaluation');

console.log(JSON.stringify(metrics, null, 2));
console.log('NW_G10_HYDROLOGY_VALIDATION_OK');
