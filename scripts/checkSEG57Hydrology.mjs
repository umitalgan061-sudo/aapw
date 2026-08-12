import assert from 'node:assert/strict';
import {
  G57_HYDROLOGY_POLICY,
  isInsideG57,
  measureG57Hydrology,
  sampleG57WaterConfidence,
} from '../godot/terrain-authoring/geocells/se/g57_hydrology.mjs';

assert.equal(G57_HYDROLOGY_POLICY.geoCell, 'G57');
assert.deepEqual(G57_HYDROLOGY_POLICY.pixelBounds, { xMin: 960, xMax: 1152, yMin: 896, yMax: 1024 });
assert.deepEqual(G57_HYDROLOGY_POLICY.maskBounds, { xMin: 60, xMax: 71, yMin: 56, yMax: 63 });
assert.equal(G57_HYDROLOGY_POLICY.sourceMapSha256, '20702972e8f45f0fbdc4da5fa68e890a82e4e822e1d58e2f369d8bc5b9c571a1');
assert.equal(isInsideG57(0.625, 0.875), true);
assert.equal(isInsideG57(0.75, 1.0), true);
assert.equal(isInsideG57(0.6249, 0.9), false);
assert.equal(sampleG57WaterConfidence(0, 0), null);
assert.throws(() => sampleG57WaterConfidence(Number.NaN, 0.9), TypeError);

const metrics = measureG57Hydrology();
assert.equal(metrics.baseCells, 96);
assert.equal(metrics.waterCells, 84, 'G57 canonical water-centre inventory changed');
assert.equal(metrics.landCells, 12, 'G57 canonical land-centre inventory changed');
assert.equal(metrics.boundaryEdges, 20, 'G57 canonical coastline topology changed');
assert.equal(metrics.centreMismatches, 0, 'canonical mask-cell centre semantics must remain exact');
assert.equal(metrics.refinedSamples, 1617);
assert.equal(metrics.fractionalSamples, 278, 'G57 fractional coastline fingerprint changed');
assert.equal(metrics.hardCellMaxStep, 1);
assert.equal(metrics.maxAdjacentStep, 0.25, 'G57 refined coastline step changed');
assert.equal(metrics.confidenceChecksum, 2586534839, 'G57 confidence checksum changed');

const rerun = measureG57Hydrology();
assert.deepEqual(rerun, metrics, 'G57 evidence must be deterministic across repeated evaluation');

console.log(JSON.stringify(metrics, null, 2));
console.log('SE_G57_HYDROLOGY_VALIDATION_OK');
