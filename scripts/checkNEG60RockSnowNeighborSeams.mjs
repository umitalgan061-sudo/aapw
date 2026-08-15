#!/usr/bin/env node
import assert from 'node:assert/strict';
import { sampleG60RockSnow } from '../godot/terrain-authoring/geocells/ne/g60_rock_snow.mjs';
import { sampleG70RockSnow } from '../godot/terrain-authoring/geocells/ne/g70_rock_snow.mjs';
import { measureG61Hydrology } from '../godot/terrain-authoring/geocells/ne/g61_hydrology.mjs';

const eastBoundary = 7 / 8;
const yMin = 0;
const yMax = 1 / 8;
const epsilon = 1 / 1536;
let eastPairs = 0;
let maxBoundaryHeightDelta = 0;
let maxAcrossHeightDelta = 0;
let maxRockDelta = 0;
let maxSnowDelta = 0;
let maxBlendDelta = 0;
for (let i = 0; i < 257; i += 1) {
  const y = yMin + (yMax - yMin) * i / 256;
  const g60Boundary = sampleG60RockSnow(eastBoundary, y);
  const g70Boundary = sampleG70RockSnow(eastBoundary, y);
  const g60Inside = sampleG60RockSnow(eastBoundary - epsilon, y);
  const g70Inside = sampleG70RockSnow(eastBoundary + epsilon, y);
  for (const sample of [g60Boundary, g70Boundary, g60Inside, g70Inside]) {
    assert.equal(sample.body, 'sea', 'G60/G70 seam left canonical sea');
    assert.equal(sample.rockWeight, 0, 'G60/G70 seam leaked rock');
    assert.equal(sample.snowWeight, 0, 'G60/G70 seam leaked snow');
  }
  maxBoundaryHeightDelta = Math.max(maxBoundaryHeightDelta, Math.abs(g60Boundary.heightMeters - g70Boundary.heightMeters));
  maxAcrossHeightDelta = Math.max(maxAcrossHeightDelta, Math.abs(g60Inside.heightMeters - g70Inside.heightMeters));
  maxRockDelta = Math.max(maxRockDelta, Math.abs(g60Inside.rockWeight - g70Inside.rockWeight));
  maxSnowDelta = Math.max(maxSnowDelta, Math.abs(g60Inside.snowWeight - g70Inside.snowWeight));
  maxBlendDelta = Math.max(maxBlendDelta, Math.abs(g60Inside.controlBlend - g70Inside.controlBlend));
  eastPairs += 1;
}
assert.equal(eastPairs, 257);
assert.equal(maxBoundaryHeightDelta, 0, 'G60/G70 boundary height differs');
assert.equal(maxAcrossHeightDelta, 0, 'G60/G70 guard height differs');
assert.equal(maxRockDelta, 0, 'G60/G70 rock seam detected');
assert.equal(maxSnowDelta, 0, 'G60/G70 snow seam detected');
assert.equal(maxBlendDelta, 0, 'G60/G70 control seam detected');

const south = measureG61Hydrology();
assert.equal(south.waterCells, 96, 'G61 south guard is no longer 96/96 water');
assert.equal(south.seaCells, 96, 'G61 south guard is no longer canonical sea');
assert.equal(south.landCells, 0, 'G61 south guard gained land');
assert.equal(south.lakeCells, 0, 'G61 south guard gained a lake');
assert.equal(south.boundaryEdges, 0, 'G61 south guard gained coastline');

const metrics = { eastPairs, maxBoundaryHeightDelta, maxAcrossHeightDelta, maxRockDelta, maxSnowDelta, maxBlendDelta, g61Water: south.waterCells, g61Land: south.landCells };
console.log(`NE_G60_ROCK_SNOW_NEIGHBOR_SEAMS=${JSON.stringify(metrics)}`);
console.log('NE_G60_ROCK_SNOW_NEIGHBOR_SEAMS_OK');
