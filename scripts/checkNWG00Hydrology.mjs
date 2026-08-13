import assert from 'node:assert/strict';
import {
  G00_HYDROLOGY_POLICY,
  isInsideG00,
  measureG00Hydrology,
  sampleG00WaterConfidence,
} from '../godot/terrain-authoring/geocells/nw/g00_hydrology.mjs';

assert.equal(G00_HYDROLOGY_POLICY.geoCell, 'G00');
assert.deepEqual(G00_HYDROLOGY_POLICY.pixelBounds, { xMin: 0, xMax: 192, yMin: 0, yMax: 128 });
assert.deepEqual(G00_HYDROLOGY_POLICY.maskBounds, { xMin: 0, xMax: 11, yMin: 0, yMax: 7 });
assert.equal(G00_HYDROLOGY_POLICY.sourceMapSha256, '20702972e8f45f0fbdc4da5fa68e890a82e4e822e1d58e2f369d8bc5b9c571a1');
assert.equal(isInsideG00(0, 0), true);
assert.equal(isInsideG00(0.125, 0.125), true);
assert.equal(isInsideG00(0.1251, 0.1), false);
assert.equal(isInsideG00(0.05, 0.1251), false);
assert.equal(sampleG00WaterConfidence(0.2, 0.2), null);
assert.throws(() => sampleG00WaterConfidence(Number.NaN, 0.2), TypeError);

const metrics = measureG00Hydrology();
assert.equal(metrics.baseCells, 96);
assert.equal(metrics.waterCells, 60, 'G00 canonical water-centre inventory changed');
assert.equal(metrics.landCells, 36, 'G00 canonical land-centre inventory changed');
assert.equal(metrics.boundaryEdges, 12, 'G00 canonical coastline topology changed');
assert.equal(metrics.centreMismatches, 0, 'canonical mask-cell centre semantics must remain exact');
assert.equal(metrics.refinedSamples, 1617);
assert.equal(metrics.fractionalSamples, 147, 'G00 fractional coastline fingerprint changed');
assert.equal(metrics.hardCellMaxStep, 1);
assert.equal(metrics.maxAdjacentStep, 0.25, 'G00 bilinear transition step changed');
assert.equal(metrics.confidenceChecksum, 2770394150, 'G00 deterministic confidence checksum changed');
assert.ok(metrics.maxAdjacentStep < metrics.hardCellMaxStep, 'bilinear refinement must reduce the hard-cell discontinuity');

const rerun = measureG00Hydrology();
assert.deepEqual(rerun, metrics, 'G00 evidence must be deterministic across repeated evaluation');

console.log(JSON.stringify(metrics, null, 2));
console.log('NW_G00_HYDROLOGY_VALIDATION_OK');
