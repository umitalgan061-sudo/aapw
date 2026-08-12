import assert from 'node:assert/strict';
import {
  G76_HYDROLOGY_POLICY,
  isInsideG76,
  measureG76Hydrology,
  sampleG76WaterConfidence,
} from '../godot/terrain-authoring/geocells/se/g76_hydrology.mjs';

assert.equal(G76_HYDROLOGY_POLICY.geoCell, 'G76');
assert.deepEqual(G76_HYDROLOGY_POLICY.pixelBounds, { xMin: 1344, xMax: 1536, yMin: 768, yMax: 896 });
assert.deepEqual(G76_HYDROLOGY_POLICY.maskBounds, { xMin: 84, xMax: 95, yMin: 48, yMax: 55 });
assert.equal(G76_HYDROLOGY_POLICY.sourceMapSha256, '20702972e8f45f0fbdc4da5fa68e890a82e4e822e1d58e2f369d8bc5b9c571a1');
assert.equal(isInsideG76(0.875, 0.75), true);
assert.equal(isInsideG76(1.0, 0.875), true);
assert.equal(isInsideG76(0.8749, 0.8), false);
assert.equal(sampleG76WaterConfidence(0, 0), null);
assert.throws(() => sampleG76WaterConfidence(Number.NaN, 0.8), TypeError);

const metrics = measureG76Hydrology();
assert.equal(metrics.baseCells, 96);
assert.equal(metrics.waterCells, 9, 'G76 canonical water-centre inventory changed');
assert.equal(metrics.landCells, 87, 'G76 canonical land-centre inventory changed');
assert.equal(metrics.boundaryEdges, 7, 'G76 canonical coastline topology changed');
assert.equal(metrics.centreMismatches, 0, 'canonical mask-cell centre semantics must remain exact');
assert.equal(metrics.refinedSamples, 1617);
assert.equal(metrics.fractionalSamples, 117, 'G76 fractional coastline fingerprint changed');
assert.equal(metrics.hardCellMaxStep, 1);
assert.equal(metrics.maxAdjacentStep, 0.25, 'G76 refined coastline step changed');
assert.equal(metrics.confidenceChecksum, 529642162, 'G76 confidence checksum changed');

const rerun = measureG76Hydrology();
assert.deepEqual(rerun, metrics, 'G76 evidence must be deterministic across repeated evaluation');

console.log(JSON.stringify(metrics, null, 2));
console.log('SE_G76_HYDROLOGY_VALIDATION_OK');
