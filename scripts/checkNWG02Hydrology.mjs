import assert from 'node:assert/strict';
import { G02_HYDROLOGY_POLICY, isInsideG02, measureG02Hydrology, sampleG02WaterConfidence } from '../godot/terrain-authoring/geocells/nw/g02_hydrology.mjs';

assert.equal(G02_HYDROLOGY_POLICY.geoCell, 'G02');
assert.deepEqual(G02_HYDROLOGY_POLICY.pixelBounds, { xMin: 0, xMax: 192, yMin: 256, yMax: 384 });
assert.deepEqual(G02_HYDROLOGY_POLICY.maskBounds, { xMin: 0, xMax: 11, yMin: 16, yMax: 23 });
assert.equal(G02_HYDROLOGY_POLICY.sourceMapSha256, '20702972e8f45f0fbdc4da5fa68e890a82e4e822e1d58e2f369d8bc5b9c571a1');
assert.equal(isInsideG02(0, 0.25), true);
assert.equal(isInsideG02(0.125, 0.375), true);
assert.equal(isInsideG02(0.1251, 0.3), false);
assert.equal(isInsideG02(0.05, 0.2499), false);
assert.equal(sampleG02WaterConfidence(0.2, 0.3), null);
assert.throws(() => sampleG02WaterConfidence(Number.NaN, 0.3), TypeError);

const metrics = measureG02Hydrology();
assert.equal(metrics.baseCells, 96);
assert.equal(metrics.waterCells, 73, 'G02 canonical water-centre inventory changed');
assert.equal(metrics.landCells, 23, 'G02 canonical land-centre inventory changed');
assert.equal(metrics.boundaryEdges, 16, 'G02 canonical coastline topology changed');
assert.equal(metrics.centreMismatches, 0, 'canonical mask-cell centre semantics must remain exact');
assert.equal(metrics.refinedSamples, 1617);
assert.equal(metrics.fractionalSamples, 222, 'G02 fractional coastline fingerprint changed');
assert.equal(metrics.hardCellMaxStep, 1);
assert.equal(metrics.maxAdjacentStep, 0.25, 'G02 bilinear transition step changed');
assert.equal(metrics.confidenceChecksum, 1014520037, 'G02 deterministic confidence checksum changed');
assert.ok(metrics.maxAdjacentStep < metrics.hardCellMaxStep);
assert.deepEqual(measureG02Hydrology(), metrics, 'G02 evidence must be deterministic');
console.log(JSON.stringify(metrics, null, 2));
console.log('NW_G02_HYDROLOGY_VALIDATION_OK');
