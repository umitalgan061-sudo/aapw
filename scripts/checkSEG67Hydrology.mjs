import assert from 'node:assert/strict';
import {
  G67_HYDROLOGY_POLICY,
  isInsideG67,
  measureG67Hydrology,
  sampleG67WaterConfidence,
} from '../godot/terrain-authoring/geocells/se/g67_hydrology.mjs';

assert.equal(G67_HYDROLOGY_POLICY.geoCell, 'G67');
assert.deepEqual(G67_HYDROLOGY_POLICY.pixelBounds, { xMin: 1152, xMax: 1344, yMin: 896, yMax: 1024 });
assert.deepEqual(G67_HYDROLOGY_POLICY.maskBounds, { xMin: 72, xMax: 83, yMin: 56, yMax: 63 });
assert.equal(G67_HYDROLOGY_POLICY.sourceMapSha256, '20702972e8f45f0fbdc4da5fa68e890a82e4e822e1d58e2f369d8bc5b9c571a1');
assert.equal(isInsideG67(0.75, 0.875), true);
assert.equal(isInsideG67(0.875, 1.0), true);
assert.equal(isInsideG67(0.7499, 0.9), false);
assert.equal(sampleG67WaterConfidence(0, 0), null);
assert.throws(() => sampleG67WaterConfidence(Number.NaN, 0.9), TypeError);

const metrics = measureG67Hydrology();
assert.equal(metrics.baseCells, 96);
assert.equal(metrics.waterCells, 95, 'G67 canonical water-centre inventory changed');
assert.equal(metrics.landCells, 1, 'G67 canonical land-centre inventory changed');
assert.equal(metrics.boundaryEdges, 2, 'G67 canonical coastline topology changed');
assert.equal(metrics.centreMismatches, 0, 'canonical mask-cell centre semantics must remain exact');
assert.equal(metrics.refinedSamples, 1617);
assert.equal(metrics.fractionalSamples, 27, 'G67 fractional coastline fingerprint changed');
assert.equal(metrics.hardCellMaxStep, 1);
assert.equal(metrics.maxAdjacentStep, 0.25, 'G67 refined coastline step changed');
assert.equal(metrics.confidenceChecksum, 1681124318, 'G67 confidence checksum changed');

const rerun = measureG67Hydrology();
assert.deepEqual(rerun, metrics, 'G67 evidence must be deterministic across repeated evaluation');

console.log(JSON.stringify(metrics, null, 2));
console.log('SE_G67_HYDROLOGY_VALIDATION_OK');
