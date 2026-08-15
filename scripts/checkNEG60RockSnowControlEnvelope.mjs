#!/usr/bin/env node
import assert from 'node:assert/strict';
import { sampleG60RockSnow } from '../godot/terrain-authoring/geocells/ne/g60_rock_snow.mjs';
import { g60ReliefGuardBounds, sampleG60Relief } from '../godot/terrain-authoring/geocells/ne/g60_relief.mjs';
import { sampleG60Biome } from '../godot/terrain-authoring/geocells/ne/g60_biome.mjs';

const bounds = g60ReliefGuardBounds();
const core = { xMin: 6 / 8, xMax: 7 / 8, yMin: 0, yMax: 1 / 8 };
const N = 193;
let samples = 0;
let nonSea = 0;
let maxRock = 0;
let maxSnow = 0;
let maxMass = 0;
let maxBlend = 0;
let maxHeightMismatch = 0;
let maxColorMismatch = 0;
let maxRoughnessMismatch = 0;
let minHeight = Infinity;
let maxHeight = -Infinity;

for (let y = 0; y < N; y += 1) {
  const ny = bounds.yMin + (bounds.yMax - bounds.yMin) * y / (N - 1);
  for (let x = 0; x < N; x += 1) {
    const nx = bounds.xMin + (bounds.xMax - bounds.xMin) * x / (N - 1);
    const sample = sampleG60RockSnow(nx, ny);
    const relief = sampleG60Relief(nx, ny);
    const biome = sampleG60Biome(nx, ny);
    samples += 1;
    if (!sample.water || sample.body !== 'sea') nonSea += 1;
    maxRock = Math.max(maxRock, Math.abs(sample.rockWeight));
    maxSnow = Math.max(maxSnow, Math.abs(sample.snowWeight));
    maxMass = Math.max(maxMass, Math.abs(sample.terrestrialSurfaceMass));
    maxBlend = Math.max(maxBlend, Math.abs(sample.controlBlend));
    maxHeightMismatch = Math.max(maxHeightMismatch, Math.abs(sample.heightMeters - relief.heightMeters));
    maxColorMismatch = Math.max(maxColorMismatch, ...sample.color.map((v, i) => Math.abs(v - biome.color[i])));
    maxRoughnessMismatch = Math.max(maxRoughnessMismatch, Math.abs(sample.roughness - biome.roughness));
    minHeight = Math.min(minHeight, sample.heightMeters);
    maxHeight = Math.max(maxHeight, sample.heightMeters);
  }
}
assert.equal(samples, N * N);
assert.equal(nonSea, 0, '193x193 envelope invented non-sea semantics');
assert.equal(maxRock, 0, '193x193 envelope leaked rock');
assert.equal(maxSnow, 0, '193x193 envelope leaked snow');
assert.equal(maxMass, 0, '193x193 envelope leaked terrestrial material');
assert.equal(maxBlend, 0, '193x193 envelope leaked Terrain3D control blend');
assert.equal(maxHeightMismatch, 0, '193x193 envelope changed Relief height');
assert.equal(maxColorMismatch, 0, '193x193 envelope changed Macro Biome color');
assert.equal(maxRoughnessMismatch, 0, '193x193 envelope changed Macro Biome roughness');
assert.equal(minHeight, -8);
assert.equal(maxHeight, -8);

// Stress the west, east and south ownership joins. The north edge is the world border.
const guard = 1 / (96 * 4);
let edgePairs = 0;
let maxEdgeBlendDelta = 0;
let maxEdgeHeightDelta = 0;
let maxEdgeMaterialDelta = 0;
for (let i = 0; i < 257; i += 1) {
  const t = i / 256;
  const nx = core.xMin + (core.xMax - core.xMin) * t;
  const ny = core.yMin + (core.yMax - core.yMin) * t;
  const pairs = [
    [[core.xMin, ny], [core.xMin - guard, ny]],
    [[core.xMax, ny], [core.xMax + guard, ny]],
    [[nx, core.yMax], [nx, core.yMax + guard]],
  ];
  for (const [[ax, ay], [bx, by]] of pairs) {
    const a = sampleG60RockSnow(ax, ay);
    const b = sampleG60RockSnow(bx, by);
    maxEdgeBlendDelta = Math.max(maxEdgeBlendDelta, Math.abs(a.controlBlend - b.controlBlend));
    maxEdgeHeightDelta = Math.max(maxEdgeHeightDelta, Math.abs(a.heightMeters - b.heightMeters));
    maxEdgeMaterialDelta = Math.max(
      maxEdgeMaterialDelta,
      ...a.color.map((v, c) => Math.abs(v - b.color[c])),
      Math.abs(a.roughness - b.roughness),
    );
    edgePairs += 1;
  }
}
assert.equal(edgePairs, 771);
assert.equal(maxEdgeBlendDelta, 0, 'owner guard developed a control seam');
assert.equal(maxEdgeHeightDelta, 0, 'owner guard developed a height seam');
assert.equal(maxEdgeMaterialDelta, 0, 'owner guard developed a color/roughness seam');

const northBorder = [[0.75, 0], [0.8125, 0], [0.875, 0]];
for (const [nx, ny] of northBorder) {
  const sample = sampleG60RockSnow(nx, ny);
  assert.equal(sample.body, 'sea');
  assert.equal(sample.rockWeight, 0);
  assert.equal(sample.snowWeight, 0, `north-border ocean invented snow at ${nx},${ny}`);
}

const metrics = {
  samples, edgePairs, northBorderSamples: northBorder.length,
  minHeight, maxHeight, maxRock, maxSnow, maxMass, maxBlend,
  maxHeightMismatch, maxColorMismatch, maxRoughnessMismatch,
  maxEdgeBlendDelta, maxEdgeHeightDelta, maxEdgeMaterialDelta,
};
console.log(`NE_G60_ROCK_SNOW_CONTROL_ENVELOPE=${JSON.stringify(metrics)}`);
console.log('NE_G60_ROCK_SNOW_CONTROL_ENVELOPE_OK');
