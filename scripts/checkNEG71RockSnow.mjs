#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  G71_TERRAIN3D_ROCK_SNOW_POLICY,
  buildG71Terrain3DRockSnowProbe,
  measureG71Terrain3DRockSnow,
  sampleG71RockSnow,
} from '../godot/terrain-authoring/geocells/ne/g71_rock_snow.mjs';
import { g71ReliefGuardBounds, sampleG71Relief } from '../godot/terrain-authoring/geocells/ne/g71_relief.mjs';
import { sampleG71Biome } from '../godot/terrain-authoring/geocells/ne/g71_biome.mjs';
import { sampleG70RockSnow } from '../godot/terrain-authoring/geocells/ne/g70_rock_snow.mjs';

const MAP_SHA = '20702972e8f45f0fbdc4da5fa68e890a82e4e822e1d58e2f369d8bc5b9c571a1';
const policy = G71_TERRAIN3D_ROCK_SNOW_POLICY;
const first = measureG71Terrain3DRockSnow();
const second = measureG71Terrain3DRockSnow();
assert.deepEqual(first, second, 'G71 Rock/Snow metrics must be deterministic');
assert.equal(first.sourceMapSha256, MAP_SHA, 'map.png provenance drifted');
assert.equal(first.geoCell, 'G71');
assert.equal(first.layer, 'Rock/Snow');
assert.equal(first.canonicalWater, 96, 'G71 must remain 96/96 canonical water');
assert.equal(first.canonicalLand, 0, 'G71 Rock/Snow invented land');
assert.equal(first.canonicalSea, 96, 'G71 Rock/Snow changed sea semantics');
assert.equal(first.canonicalLake, 0, 'G71 Rock/Snow invented a lake');
assert.equal(first.boundaryEdges, 0, 'G71 Rock/Snow invented coastline');
assert.equal(first.priorBiomeCanonicalSea, 96, 'merged G71 Biome provenance drifted');
assert.equal(first.haloNonSeaSamples, 0, 'G71 neighbor halo is no longer canonical sea');
assert.equal(first.sourceSamples, 65 * 65);
assert.equal(first.nonSeaSamples, 0, 'guard-backed source invented non-sea semantics');
assert.equal(first.maxRockWeight, 0, 'rock leaked onto canonical sea');
assert.equal(first.maxSnowWeight, 0, 'snow leaked onto canonical sea');
assert.equal(first.maxTerrestrialSurfaceMass, 0, 'terrestrial material leaked onto sea');
assert.equal(first.maxHeightMismatch, 0, 'Rock/Snow changed merged Relief height');
assert.equal(first.maxColorMismatch, 0, 'Rock/Snow changed merged Biome color');
assert.equal(first.maxRoughnessMismatch, 0, 'Rock/Snow changed merged Biome roughness');
assert.equal(first.maxAdjacentBlendStep, 0, 'zero-overlay field developed a source-grid step');
assert.equal(first.maxGuardBlendDelta, 0, 'G71 material guard developed a seam');
assert.equal(first.guardPairs, 65 * 3, 'west/north/south guard coverage drifted');
assert.equal(first.reliefMinHeight, -8);
assert.equal(first.reliefMaxHeight, -8);
assert.equal(first.eastWorldBoundaryX, 1);
assert.equal(first.eastGuardAllowed, false);
assert.equal(policy.terrain3dImportSize, 257);
assert.equal(policy.terrain3dRegionSize, 256);
assert.equal(policy.syntheticRockWeight, 0);
assert.equal(policy.syntheticSnowWeight, 0);

const probeA = buildG71Terrain3DRockSnowProbe();
const probeB = buildG71Terrain3DRockSnowProbe();
assert.deepEqual(probeA, probeB, 'G71 Rock/Snow probe must be byte-deterministic');
assert.equal(probeA.schema, 'westeros-g71-terrain3d-rock-snow-probe-v1');
assert.equal(probeA.rows.length, 65);
assert.ok(probeA.rows.every((row) => row.length === 65), 'unexpected 65x65 probe dimensions');
for (const row of probeA.rows) for (const sample of row) {
  assert.equal(sample.length, 9, 'Rock/Snow probe channel count changed');
  assert.equal(sample[0], 0, 'probe rock weight must stay zero');
  assert.equal(sample[1], 0, 'probe snow weight must stay zero');
  assert.equal(sample[2], 0, 'probe terrestrial mass must stay zero');
  assert.equal(sample[3], -8, 'probe changed qualified Relief height');
  assert.equal(sample[4], 0, 'probe Terrain3D control blend must stay zero');
  assert.equal(sample[5], 0.16, 'probe changed Biome red channel');
  assert.equal(sample[6], 0.30, 'probe changed Biome green channel');
  assert.equal(sample[7], 0.36, 'probe changed Biome blue channel');
  assert.equal(sample[8], 0.86, 'probe changed Biome roughness');
}

const guard = g71ReliefGuardBounds();
let envelopeSamples = 0;
let envelopeNonSea = 0;
let envelopeRockLeak = 0;
let envelopeSnowLeak = 0;
let envelopeHeightMismatch = 0;
let envelopeMaterialMismatch = 0;
for (let y = 0; y < 129; y += 1) {
  const ny = guard.yMin + (guard.yMax - guard.yMin) * y / 128;
  for (let x = 0; x < 129; x += 1) {
    const nx = guard.xMin + (guard.xMax - guard.xMin) * x / 128;
    const sample = sampleG71RockSnow(nx, ny);
    const relief = sampleG71Relief(nx, ny);
    const biome = sampleG71Biome(nx, ny);
    envelopeSamples += 1;
    if (!sample.water || sample.body !== 'sea') envelopeNonSea += 1;
    envelopeRockLeak = Math.max(envelopeRockLeak, Math.abs(sample.rockWeight));
    envelopeSnowLeak = Math.max(envelopeSnowLeak, Math.abs(sample.snowWeight));
    envelopeHeightMismatch = Math.max(envelopeHeightMismatch, Math.abs(sample.heightMeters - relief.heightMeters));
    envelopeMaterialMismatch = Math.max(
      envelopeMaterialMismatch,
      ...sample.color.map((v, i) => Math.abs(v - biome.color[i])),
      Math.abs(sample.roughness - biome.roughness),
    );
  }
}
assert.equal(envelopeSamples, 129 * 129);
assert.equal(envelopeNonSea, 0);
assert.equal(envelopeRockLeak, 0);
assert.equal(envelopeSnowLeak, 0);
assert.equal(envelopeHeightMismatch, 0);
assert.equal(envelopeMaterialMismatch, 0);

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

const expectedMaterial = [0.16, 0.30, 0.36, 0.86];
let importSamples = 0;
let maxFilteredRock = 0, maxFilteredSnow = 0, maxFilteredBlend = 0;
let minFilteredHeight = Infinity, maxFilteredHeight = -Infinity, maxFilteredMaterialDelta = 0;
for (let z = 0; z < 257; z += 1) for (let x = 0; x < 257; x += 1) {
  const u = x / 256, v = z / 256;
  maxFilteredRock = Math.max(maxFilteredRock, Math.abs(bilerp(0, u, v)));
  maxFilteredSnow = Math.max(maxFilteredSnow, Math.abs(bilerp(1, u, v)));
  maxFilteredBlend = Math.max(maxFilteredBlend, Math.abs(bilerp(4, u, v)));
  const height = bilerp(3, u, v);
  minFilteredHeight = Math.min(minFilteredHeight, height);
  maxFilteredHeight = Math.max(maxFilteredHeight, height);
  for (let c = 0; c < 4; c += 1) {
    maxFilteredMaterialDelta = Math.max(maxFilteredMaterialDelta, Math.abs(bilerp(5 + c, u, v) - expectedMaterial[c]));
  }
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
let maxSeamBlend = 0, maxSeamHeightDelta = 0, maxSeamMaterialDelta = 0;
for (const edge of seamAxis) for (const cross of crossAxis) for (const [x, z] of [[edge, cross], [cross, edge]]) {
  const u = x / 256, v = z / 256;
  maxSeamBlend = Math.max(maxSeamBlend, Math.abs(bilerp(4, u, v)));
  maxSeamHeightDelta = Math.max(maxSeamHeightDelta, Math.abs(bilerp(3, u, v) + 8));
  for (let c = 0; c < 4; c += 1) {
    maxSeamMaterialDelta = Math.max(maxSeamMaterialDelta, Math.abs(bilerp(5 + c, u, v) - expectedMaterial[c]));
  }
  seamSamples += 1;
}
assert.equal(seamSamples, 60);
assert.equal(maxSeamBlend, 0);
assert.equal(maxSeamHeightDelta, 0);
assert.equal(maxSeamMaterialDelta, 0);

let sharedNorthSamples = 0;
let maxNorthHeightDelta = 0, maxNorthRockDelta = 0, maxNorthSnowDelta = 0;
for (let i = 0; i < 129; i += 1) {
  const nx = policy.normalizedBounds.xMin + (policy.normalizedBounds.xMax - policy.normalizedBounds.xMin) * i / 128;
  const northY = policy.normalizedBounds.yMin;
  const current = sampleG71RockSnow(nx, northY);
  const north = sampleG70RockSnow(nx, northY);
  maxNorthHeightDelta = Math.max(maxNorthHeightDelta, Math.abs(current.heightMeters - north.heightMeters));
  maxNorthRockDelta = Math.max(maxNorthRockDelta, Math.abs(current.rockWeight - north.rockWeight));
  maxNorthSnowDelta = Math.max(maxNorthSnowDelta, Math.abs(current.snowWeight - north.snowWeight));
  sharedNorthSamples += 1;
}
assert.equal(sharedNorthSamples, 129);
assert.equal(maxNorthHeightDelta, 0, 'G70/G71 shared north edge height diverged');
assert.equal(maxNorthRockDelta, 0, 'G70/G71 shared north edge rock diverged');
assert.equal(maxNorthSnowDelta, 0, 'G70/G71 shared north edge snow diverged');
assert.throws(() => sampleG71RockSnow(1 + 1e-9, 3 / 16), RangeError, 'east world boundary must reject guard sampling');
assert.throws(() => sampleG71RockSnow(Number.NaN, 3 / 16), TypeError);

const metrics = Object.freeze({
  ...first,
  envelopeSamples, envelopeNonSea, envelopeRockLeak, envelopeSnowLeak,
  envelopeHeightMismatch, envelopeMaterialMismatch,
  importSamples, maxFilteredRock, maxFilteredSnow, maxFilteredBlend,
  minFilteredHeight, maxFilteredHeight, maxFilteredMaterialDelta,
  seamSamples, maxSeamBlend, maxSeamHeightDelta, maxSeamMaterialDelta,
  sharedNorthSamples, maxNorthHeightDelta, maxNorthRockDelta, maxNorthSnowDelta,
});
const emit = process.argv.find((arg) => arg.startsWith('--emit-probe='));
if (emit) {
  const output = path.resolve(emit.slice('--emit-probe='.length));
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify(probeA)}\n`, 'utf8');
}
console.log(`NE_G71_ROCK_SNOW_METRICS=${JSON.stringify(metrics)}`);
console.log('NE_G71_ROCK_SNOW_VALIDATION_OK');
