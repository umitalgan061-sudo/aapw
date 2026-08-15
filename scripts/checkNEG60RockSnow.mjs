#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  G60_TERRAIN3D_ROCK_SNOW_POLICY,
  buildG60Terrain3DRockSnowProbe,
  measureG60Terrain3DRockSnow,
  sampleG60RockSnow,
} from '../godot/terrain-authoring/geocells/ne/g60_rock_snow.mjs';
import { g60ReliefGuardBounds, sampleG60Relief } from '../godot/terrain-authoring/geocells/ne/g60_relief.mjs';
import { sampleG60Biome } from '../godot/terrain-authoring/geocells/ne/g60_biome.mjs';

const MAP_SHA = '20702972e8f45f0fbdc4da5fa68e890a82e4e822e1d58e2f369d8bc5b9c571a1';
const policy = G60_TERRAIN3D_ROCK_SNOW_POLICY;
const first = measureG60Terrain3DRockSnow();
const second = measureG60Terrain3DRockSnow();
assert.deepEqual(first, second, 'G60 Rock/Snow metrics must be deterministic');
assert.equal(first.sourceMapSha256, MAP_SHA, 'map.png provenance drifted');
assert.equal(first.geoCell, 'G60');
assert.equal(first.layer, 'Rock/Snow');
assert.equal(first.canonicalWater, 96, 'G60 must remain 96/96 canonical water');
assert.equal(first.canonicalLand, 0, 'G60 Rock/Snow invented land');
assert.equal(first.canonicalSea, 96, 'G60 Rock/Snow changed sea semantics');
assert.equal(first.canonicalLake, 0, 'G60 Rock/Snow invented a lake');
assert.equal(first.boundaryEdges, 0, 'G60 Rock/Snow invented coastline');
assert.equal(first.sourceSamples, 65 * 65);
assert.equal(first.nonSeaSamples, 0, 'guard-backed source invented non-sea semantics');
assert.equal(first.maxRockWeight, 0, 'rock leaked onto canonical sea');
assert.equal(first.maxSnowWeight, 0, 'snow leaked onto canonical sea');
assert.equal(first.maxTerrestrialSurfaceMass, 0, 'terrestrial material leaked onto sea');
assert.equal(first.maxHeightMismatch, 0, 'Rock/Snow changed merged Relief height');
assert.equal(first.maxColorMismatch, 0, 'Rock/Snow changed merged Biome color');
assert.equal(first.maxRoughnessMismatch, 0, 'Rock/Snow changed merged Biome roughness');
assert.equal(first.maxAdjacentBlendStep, 0, 'zero-overlay field developed a source-grid step');
assert.equal(first.maxGuardBlendDelta, 0, 'G60 material guard developed a seam');
assert.equal(first.reliefMinHeight, -8);
assert.equal(first.reliefMaxHeight, -8);
assert.equal(policy.terrain3dImportSize, 257);
assert.equal(policy.terrain3dRegionSize, 256);

const probeA = buildG60Terrain3DRockSnowProbe();
const probeB = buildG60Terrain3DRockSnowProbe();
assert.deepEqual(probeA, probeB, 'G60 Rock/Snow probe must be byte-deterministic');
assert.equal(probeA.schema, 'westeros-g60-terrain3d-rock-snow-probe-v1');
assert.equal(probeA.rows.length, 65);
assert.ok(probeA.rows.every((row) => row.length === 65), 'unexpected 65x65 probe dimensions');
for (const row of probeA.rows) for (const sample of row) {
  assert.equal(sample.length, 9, 'Rock/Snow probe channel count changed');
  assert.equal(sample[0], 0, 'probe rock weight must stay zero');
  assert.equal(sample[1], 0, 'probe snow weight must stay zero');
  assert.equal(sample[2], 0, 'probe terrestrial mass must stay zero');
  assert.equal(sample[3], -8, 'probe changed qualified Relief height');
  assert.equal(sample[4], 0, 'probe Terrain3D control blend must stay zero');
  assert.equal(sample[5], 0.16, 'probe changed qualified Biome red channel');
  assert.equal(sample[6], 0.30, 'probe changed qualified Biome green channel');
  assert.equal(sample[7], 0.36, 'probe changed qualified Biome blue channel');
  assert.equal(sample[8], 0.86, 'probe changed qualified Biome roughness');
}

const guard = g60ReliefGuardBounds();
let envelopeSamples = 0;
let envelopeNonSea = 0;
let envelopeRockLeak = 0;
let envelopeSnowLeak = 0;
let envelopeHeightMismatch = 0;
let envelopeColorMismatch = 0;
let envelopeRoughnessMismatch = 0;
for (let y = 0; y < 129; y += 1) {
  const ny = guard.yMin + (guard.yMax - guard.yMin) * y / 128;
  for (let x = 0; x < 129; x += 1) {
    const nx = guard.xMin + (guard.xMax - guard.xMin) * x / 128;
    const sample = sampleG60RockSnow(nx, ny);
    const relief = sampleG60Relief(nx, ny);
    const biome = sampleG60Biome(nx, ny);
    envelopeSamples += 1;
    if (!sample.water || sample.body !== 'sea') envelopeNonSea += 1;
    envelopeRockLeak = Math.max(envelopeRockLeak, Math.abs(sample.rockWeight));
    envelopeSnowLeak = Math.max(envelopeSnowLeak, Math.abs(sample.snowWeight));
    envelopeHeightMismatch = Math.max(envelopeHeightMismatch, Math.abs(sample.heightMeters - relief.heightMeters));
    envelopeColorMismatch = Math.max(envelopeColorMismatch, ...sample.color.map((v, i) => Math.abs(v - biome.color[i])));
    envelopeRoughnessMismatch = Math.max(envelopeRoughnessMismatch, Math.abs(sample.roughness - biome.roughness));
  }
}
assert.equal(envelopeSamples, 129 * 129);
assert.equal(envelopeNonSea, 0);
assert.equal(envelopeRockLeak, 0);
assert.equal(envelopeSnowLeak, 0);
assert.equal(envelopeHeightMismatch, 0);
assert.equal(envelopeColorMismatch, 0);
assert.equal(envelopeRoughnessMismatch, 0);

function bilerp(channel, u, v) {
  const size = probeA.sourceGridSize;
  const gx = Math.max(0, Math.min(1, u)) * (size - 1);
  const gy = Math.max(0, Math.min(1, v)) * (size - 1);
  const x0 = Math.floor(gx), y0 = Math.floor(gy);
  const x1 = Math.min(x0 + 1, size - 1), y1 = Math.min(y0 + 1, size - 1);
  const tx = gx - x0, ty = gy - y0;
  const top = probeA.rows[y0][x0][channel] + (probeA.rows[y0][x1][channel] - probeA.rows[y0][x0][channel]) * tx;
  const bottom = probeA.rows[y1][x0][channel] + (probeA.rows[y1][x1][channel] - probeA.rows[y1][x0][channel]) * tx;
  return top + (bottom - top) * ty;
}

let importSamples = 0;
let maxFilteredRock = 0;
let maxFilteredSnow = 0;
let maxFilteredBlend = 0;
let minFilteredHeight = Infinity;
let maxFilteredHeight = -Infinity;
let maxFilteredMaterialDelta = 0;
const expectedMaterial = [0.16, 0.30, 0.36, 0.86];
for (let z = 0; z < 257; z += 1) for (let x = 0; x < 257; x += 1) {
  const u = x / 256, v = z / 256;
  maxFilteredRock = Math.max(maxFilteredRock, Math.abs(bilerp(0, u, v)));
  maxFilteredSnow = Math.max(maxFilteredSnow, Math.abs(bilerp(1, u, v)));
  maxFilteredBlend = Math.max(maxFilteredBlend, Math.abs(bilerp(4, u, v)));
  const height = bilerp(3, u, v);
  minFilteredHeight = Math.min(minFilteredHeight, height);
  maxFilteredHeight = Math.max(maxFilteredHeight, height);
  for (let c = 0; c < 4; c += 1) maxFilteredMaterialDelta = Math.max(
    maxFilteredMaterialDelta,
    Math.abs(bilerp(5 + c, u, v) - expectedMaterial[c]),
  );
  importSamples += 1;
}
assert.equal(importSamples, 257 * 257);
assert.equal(maxFilteredRock, 0);
assert.equal(maxFilteredSnow, 0);
assert.equal(maxFilteredBlend, 0);
assert.equal(minFilteredHeight, -8);
assert.equal(maxFilteredHeight, -8);
assert.equal(maxFilteredMaterialDelta, 0);

const seamAxis = [254.75, 255, 255.25, 255.5, 255.75, 256];
const crossAxis = [32.25, 96.5, 160.75, 224.5, 256];
let seamSamples = 0;
let maxSeamBlend = 0;
let maxSeamHeightDelta = 0;
let maxSeamMaterialDelta = 0;
for (const edge of seamAxis) for (const cross of crossAxis) {
  for (const [x, z] of [[edge, cross], [cross, edge]]) {
    const u = x / 256, v = z / 256;
    maxSeamBlend = Math.max(maxSeamBlend, Math.abs(bilerp(4, u, v)));
    maxSeamHeightDelta = Math.max(maxSeamHeightDelta, Math.abs(bilerp(3, u, v) + 8));
    for (let c = 0; c < 4; c += 1) maxSeamMaterialDelta = Math.max(
      maxSeamMaterialDelta,
      Math.abs(bilerp(5 + c, u, v) - expectedMaterial[c]),
    );
    seamSamples += 1;
  }
}
assert.equal(seamSamples, 60);
assert.equal(maxSeamBlend, 0);
assert.equal(maxSeamHeightDelta, 0);
assert.equal(maxSeamMaterialDelta, 0);

const metrics = Object.freeze({
  ...first,
  envelopeSamples, envelopeNonSea, envelopeRockLeak, envelopeSnowLeak,
  envelopeHeightMismatch, envelopeColorMismatch, envelopeRoughnessMismatch,
  importSamples, maxFilteredRock, maxFilteredSnow, maxFilteredBlend,
  minFilteredHeight, maxFilteredHeight, maxFilteredMaterialDelta,
  seamSamples, maxSeamBlend, maxSeamHeightDelta, maxSeamMaterialDelta,
});
const emit = process.argv.find((arg) => arg.startsWith('--emit-probe='));
if (emit) {
  const output = path.resolve(emit.slice('--emit-probe='.length));
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify(probeA)}\n`, 'utf8');
}
console.log(`NE_G60_ROCK_SNOW_METRICS=${JSON.stringify(metrics)}`);
console.log('NE_G60_ROCK_SNOW_VALIDATION_OK');
