import assert from 'node:assert/strict';
import { G51_HYDROLOGY_POLICY, isInsideG51, measureG51Hydrology, sampleG51WaterConfidence } from '../godot/terrain-authoring/geocells/ne/g51_hydrology.mjs';

assert.equal(G51_HYDROLOGY_POLICY.geoCell, 'G51');
assert.deepEqual(G51_HYDROLOGY_POLICY.pixelBounds, { xMin: 960, xMax: 1152, yMin: 128, yMax: 256 });
assert.deepEqual(G51_HYDROLOGY_POLICY.maskBounds, { xMin: 60, xMax: 71, yMin: 8, yMax: 15 });
assert.equal(G51_HYDROLOGY_POLICY.sourceMapSha256, '20702972e8f45f0fbdc4da5fa68e890a82e4e822e1d58e2f369d8bc5b9c571a1');
assert.equal(isInsideG51(0.625, 0.125), true);
assert.equal(isInsideG51(0.75, 0.25), true);
assert.equal(isInsideG51(0.7501, 0.2), false);
assert.equal(isInsideG51(0.7, 0.1249), false);
assert.equal(sampleG51WaterConfidence(0.8, 0.2), null);
assert.throws(() => sampleG51WaterConfidence(Number.NaN, 0.2), TypeError);

const metrics = measureG51Hydrology();
assert.equal(metrics.baseCells, 96);
assert.equal(metrics.waterCells, 95, 'G51 canonical water-centre inventory changed');
assert.equal(metrics.landCells, 1, 'G51 canonical land-centre inventory changed');
assert.equal(metrics.boundaryEdges, 3, 'G51 canonical coastline topology changed');
assert.equal(metrics.centreMismatches, 0, 'canonical mask-cell centre semantics must remain exact');
assert.equal(metrics.refinedSamples, 1617);
assert.equal(metrics.fractionalSamples, 55, 'G51 fractional coastline fingerprint changed');
assert.equal(metrics.hardCellMaxStep, 1);
assert.equal(metrics.maxAdjacentStep, 0.25, 'G51 bilinear transition step changed');
assert.equal(metrics.confidenceChecksum, 808989801, 'G51 deterministic confidence checksum changed');
assert.ok(metrics.maxAdjacentStep < metrics.hardCellMaxStep);
assert.deepEqual(measureG51Hydrology(), metrics, 'G51 evidence must be deterministic');
console.log(JSON.stringify(metrics, null, 2));
console.log('NE_G51_HYDROLOGY_VALIDATION_OK');
