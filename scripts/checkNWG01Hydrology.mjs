import assert from 'node:assert/strict';
import {
  G01_HYDROLOGY_POLICY,
  isInsideG01,
  measureG01Hydrology,
  sampleG01WaterConfidence,
} from '../godot/terrain-authoring/geocells/nw/g01_hydrology.mjs';

assert.equal(G01_HYDROLOGY_POLICY.geoCell, 'G01');
assert.deepEqual(G01_HYDROLOGY_POLICY.pixelBounds, { xMin: 0, xMax: 192, yMin: 128, yMax: 256 });
assert.deepEqual(G01_HYDROLOGY_POLICY.maskBounds, { xMin: 0, xMax: 11, yMin: 8, yMax: 15 });
assert.equal(G01_HYDROLOGY_POLICY.sourceMapSha256, '20702972e8f45f0fbdc4da5fa68e890a82e4e822e1d58e2f369d8bc5b9c571a1');
assert.equal(isInsideG01(0, 0.125), true);
assert.equal(isInsideG01(0.125, 0.25), true);
assert.equal(isInsideG01(0.1251, 0.2), false);
assert.equal(isInsideG01(0.05, 0.1249), false);
assert.equal(sampleG01WaterConfidence(0.2, 0.2), null);
assert.throws(() => sampleG01WaterConfidence(Number.NaN, 0.2), TypeError);

const metrics = measureG01Hydrology();
assert.equal(metrics.baseCells, 96);
assert.equal(metrics.waterCells, 88, 'G01 canonical water-centre inventory changed');
assert.equal(metrics.landCells, 8, 'G01 canonical land-centre inventory changed');
assert.equal(metrics.boundaryEdges, 9, 'G01 canonical coastline topology changed');
assert.equal(metrics.centreMismatches, 0, 'canonical mask-cell centre semantics must remain exact');
assert.equal(metrics.refinedSamples, 1617);
assert.equal(metrics.fractionalSamples, 130, 'G01 fractional coastline fingerprint changed');
assert.equal(metrics.hardCellMaxStep, 1);
assert.equal(metrics.maxAdjacentStep, 0.25, 'G01 bilinear transition step changed');
assert.equal(metrics.confidenceChecksum, 2237541341, 'G01 deterministic confidence checksum changed');
assert.ok(metrics.maxAdjacentStep < metrics.hardCellMaxStep, 'bilinear refinement must reduce the hard-cell discontinuity');

const rerun = measureG01Hydrology();
assert.deepEqual(rerun, metrics, 'G01 evidence must be deterministic across repeated evaluation');

console.log(JSON.stringify(metrics, null, 2));
console.log('NW_G01_HYDROLOGY_VALIDATION_OK');
