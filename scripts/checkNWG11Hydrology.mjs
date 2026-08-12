import assert from 'node:assert/strict';
import {
  G11_HYDROLOGY_POLICY,
  isInsideG11,
  measureG11Hydrology,
  sampleG11WaterConfidence,
} from '../godot/terrain-authoring/geocells/nw/g11_hydrology.mjs';

assert.equal(G11_HYDROLOGY_POLICY.geoCell, 'G11');
assert.deepEqual(G11_HYDROLOGY_POLICY.pixelBounds, { xMin: 192, xMax: 384, yMin: 128, yMax: 256 });
assert.deepEqual(G11_HYDROLOGY_POLICY.maskBounds, { xMin: 12, xMax: 23, yMin: 8, yMax: 15 });
assert.equal(G11_HYDROLOGY_POLICY.sourceMapSha256, '20702972e8f45f0fbdc4da5fa68e890a82e4e822e1d58e2f369d8bc5b9c571a1');
assert.equal(isInsideG11(0.125, 0.125), true);
assert.equal(isInsideG11(0.25, 0.25), true);
assert.equal(isInsideG11(0.1249, 0.2), false);
assert.equal(isInsideG11(0.2, 0.2501), false);
assert.equal(sampleG11WaterConfidence(0.05, 0.2), null);
assert.throws(() => sampleG11WaterConfidence(Number.NaN, 0.2), TypeError);

const metrics = measureG11Hydrology();
assert.equal(metrics.baseCells, 96);
assert.equal(metrics.waterCells, 38, 'G11 canonical water-centre inventory changed');
assert.equal(metrics.landCells, 58, 'G11 canonical land-centre inventory changed');
assert.equal(metrics.boundaryEdges, 39, 'G11 canonical coastline topology changed');
assert.equal(metrics.centreMismatches, 0, 'canonical mask-cell centre semantics must remain exact');
assert.equal(metrics.refinedSamples, 1617);
assert.equal(metrics.fractionalSamples, 524, 'G11 fractional coastline fingerprint changed');
assert.equal(metrics.hardCellMaxStep, 1);
assert.equal(metrics.maxAdjacentStep, 0.25, 'G11 bilinear transition step changed');
assert.equal(metrics.confidenceChecksum, 1445798648, 'G11 deterministic confidence checksum changed');
assert.ok(metrics.maxAdjacentStep < metrics.hardCellMaxStep, 'bilinear refinement must reduce the hard-cell discontinuity');

const rerun = measureG11Hydrology();
assert.deepEqual(rerun, metrics, 'G11 evidence must be deterministic across repeated evaluation');

console.log(JSON.stringify(metrics, null, 2));
console.log('NW_G11_HYDROLOGY_VALIDATION_OK');
