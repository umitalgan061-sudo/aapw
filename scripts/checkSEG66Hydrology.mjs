import assert from 'node:assert/strict';
import {
  G66_HYDROLOGY_POLICY,
  isInsideG66,
  measureG66Hydrology,
  sampleG66WaterConfidence,
} from '../godot/terrain-authoring/geocells/se/g66_hydrology.mjs';

assert.equal(G66_HYDROLOGY_POLICY.geoCell, 'G66');
assert.deepEqual(G66_HYDROLOGY_POLICY.pixelBounds, { xMin: 1152, xMax: 1344, yMin: 768, yMax: 896 });
assert.deepEqual(G66_HYDROLOGY_POLICY.maskBounds, { xMin: 72, xMax: 83, yMin: 48, yMax: 55 });
assert.equal(G66_HYDROLOGY_POLICY.sourceMapSha256, '20702972e8f45f0fbdc4da5fa68e890a82e4e822e1d58e2f369d8bc5b9c571a1');
assert.equal(isInsideG66(0.75, 0.75), true);
assert.equal(isInsideG66(0.875, 0.875), true);
assert.equal(isInsideG66(0.7499, 0.8), false);
assert.equal(sampleG66WaterConfidence(0, 0), null);
assert.throws(() => sampleG66WaterConfidence(Number.NaN, 0.8), TypeError);

const metrics = measureG66Hydrology();
assert.equal(metrics.baseCells, 96);
assert.equal(metrics.waterCells, 59, 'G66 canonical water-centre inventory changed');
assert.equal(metrics.landCells, 37, 'G66 canonical land-centre inventory changed');
assert.equal(metrics.boundaryEdges, 35, 'G66 canonical coastline topology changed');
assert.equal(metrics.centreMismatches, 0, 'canonical mask-cell centre semantics must remain exact');
assert.equal(metrics.refinedSamples, 1617);
assert.equal(metrics.fractionalSamples, 437, 'G66 fractional coastline fingerprint changed');
assert.equal(metrics.hardCellMaxStep, 1);
assert.equal(metrics.maxAdjacentStep, 0.25, 'G66 refined coastline step changed');
assert.equal(metrics.confidenceChecksum, 478457797, 'G66 confidence checksum changed');

const rerun = measureG66Hydrology();
assert.deepEqual(rerun, metrics, 'G66 evidence must be deterministic across repeated evaluation');

console.log(JSON.stringify(metrics, null, 2));
console.log('SE_G66_HYDROLOGY_VALIDATION_OK');
