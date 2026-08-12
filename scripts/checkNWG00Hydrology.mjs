#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  G00_HYDROLOGY_POLICY,
  isInsideG00,
  measureG00Hydrology,
  sampleG00WaterConfidence,
} from '../src/3d/world/worldReferenceGeoCellG00Hydrology.js';

assert.equal(G00_HYDROLOGY_POLICY.geoCell, 'G00');
assert.deepEqual(G00_HYDROLOGY_POLICY.pixelBounds, { xMin: 0, xMax: 192, yMin: 0, yMax: 128 });
assert.equal(isInsideG00(0, 0), true);
assert.equal(isInsideG00(0.125, 0.125), true);
assert.equal(isInsideG00(0.126, 0.1), false);
assert.equal(sampleG00WaterConfidence(0.2, 0.2), null);

const first = measureG00Hydrology();
const second = measureG00Hydrology();
assert.deepEqual(first, second, 'G00 refinement must be deterministic');
assert.equal(first.baseCells, 96, 'G00 must cover exactly 12x8 canonical mask cells');
assert.equal(first.refinedSamples, 1536, '4x sub-cell proof must cover 48x32 samples');
assert.equal(first.centreMismatches, 0, 'refinement must preserve every source mask cell centre');
assert.ok(first.waterCells > 0, 'G00 should contain canonical water');
assert.ok(first.landCells > 0, 'G00 should contain canonical land');
assert.ok(first.boundaryEdges > 0, 'G00 should contain a measurable coastline boundary');

let fractionalSamples = 0;
let previous = null;
let maxStep = 0;
for (let i = 0; i <= 512; i += 1) {
  const x = 0.125 * (i / 512);
  const confidence = sampleG00WaterConfidence(x, 0.0625);
  if (confidence > 0 && confidence < 1) fractionalSamples += 1;
  if (previous !== null) maxStep = Math.max(maxStep, Math.abs(confidence - previous));
  previous = confidence;
}
assert.ok(fractionalSamples > 0, 'refined field must produce sub-cell coastline transitions');
assert.ok(maxStep < 0.1, `refined coastline should be continuous at dense sampling, maxStep=${maxStep}`);

console.log('NW_G00_HYDROLOGY_OK', JSON.stringify({ ...first, fractionalSamples, maxStep }));
