#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  G77_HYDROLOGY_POLICY,
  isInsideG77,
  measureG77Hydrology,
  sampleG77WaterConfidence,
} from './terrain/worldReferenceGeoCellG77Hydrology.mjs';

assert.equal(G77_HYDROLOGY_POLICY.geoCell, 'G77');
assert.deepEqual(G77_HYDROLOGY_POLICY.pixelBounds, { xMin: 1344, xMax: 1536, yMin: 896, yMax: 1024 });
assert.deepEqual(G77_HYDROLOGY_POLICY.maskCellBounds, { xMin: 84, xMax: 96, yMin: 56, yMax: 64 });
assert.equal(isInsideG77(0.875, 0.875), true);
assert.equal(isInsideG77(1, 1), true);
assert.equal(isInsideG77(0.8749, 0.9), false);
assert.equal(sampleG77WaterConfidence(0.5, 0.5), null);

const first = measureG77Hydrology();
const second = measureG77Hydrology();
assert.deepEqual(first, second, 'G77 refinement must be deterministic');
assert.equal(first.baseCells, 96, 'G77 must cover exactly 12x8 canonical mask cells');
assert.equal(first.refinedSamples, 1536, '4x sub-cell proof must cover 48x32 samples');
assert.equal(first.centreMismatches, 0, 'refinement must preserve all canonical mask-cell centres');
assert.equal(first.waterCells, 44, 'G77 canonical water-cell count drifted');
assert.equal(first.landCells, 52, 'G77 canonical land-cell count drifted');
assert.equal(first.seaCells, 44, 'G77 water is expected to remain border-connected sea');
assert.equal(first.lakeCells, 0, 'G77 must not invent an enclosed lake');
assert.equal(first.boundaryEdges, 34, 'G77 coastline topology changed unexpectedly');
assert.equal(first.confidenceChecksum, 1717343132, 'G77 refined confidence fingerprint changed');

let fractionalSamples = 0;
let previous = null;
let maxStep = 0;
for (let i = 0; i <= 512; i += 1) {
  const x = 0.875 + 0.125 * (i / 512);
  const confidence = sampleG77WaterConfidence(x, 0.94);
  if (confidence > 0 && confidence < 1) fractionalSamples += 1;
  if (previous !== null) maxStep = Math.max(maxStep, Math.abs(confidence - previous));
  previous = confidence;
}
assert.ok(fractionalSamples > 0, 'refined field must create sub-cell coastline transitions');
assert.ok(maxStep < 0.1, `dense G77 coastline sampling must remain continuous, maxStep=${maxStep}`);

console.log('SE_G77_HYDROLOGY_OK', JSON.stringify({ ...first, fractionalSamples, maxStep }));
