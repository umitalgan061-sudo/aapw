import assert from 'node:assert/strict';
import { G56_HYDROLOGY_POLICY, isInsideG56, measureG56Hydrology, sampleG56WaterConfidence } from '../godot/terrain-authoring/geocells/se/g56_hydrology.mjs';

assert.equal(G56_HYDROLOGY_POLICY.geoCell, 'G56');
assert.deepEqual(G56_HYDROLOGY_POLICY.pixelBounds, { xMin: 960, xMax: 1152, yMin: 768, yMax: 896 });
assert.deepEqual(G56_HYDROLOGY_POLICY.maskBounds, { xMin: 60, xMax: 71, yMin: 48, yMax: 55 });
assert.equal(G56_HYDROLOGY_POLICY.sourceMapSha256, '20702972e8f45f0fbdc4da5fa68e890a82e4e822e1d58e2f369d8bc5b9c571a1');
assert.equal(isInsideG56(0.625, 0.75), true);
assert.equal(isInsideG56(0.75, 0.875), true);
assert.equal(isInsideG56(0.6249, 0.8), false);
assert.equal(sampleG56WaterConfidence(0, 0), null);
assert.throws(() => sampleG56WaterConfidence(Number.NaN, 0.8), TypeError);

const metrics = measureG56Hydrology();
assert.equal(metrics.baseCells, 96);
assert.equal(metrics.waterCells, 69);
assert.equal(metrics.landCells, 27);
assert.equal(metrics.boundaryEdges, 23);
assert.equal(metrics.centreMismatches, 0);
assert.equal(metrics.refinedSamples, 1617);
assert.equal(metrics.fractionalSamples, 355);
assert.equal(metrics.hardCellMaxStep, 1);
assert.equal(metrics.maxAdjacentStep, 0.25);
assert.equal(metrics.confidenceChecksum, 1442047954);
assert.deepEqual(measureG56Hydrology(), metrics);
console.log(JSON.stringify(metrics, null, 2));
console.log('SE_G56_HYDROLOGY_VALIDATION_OK');
