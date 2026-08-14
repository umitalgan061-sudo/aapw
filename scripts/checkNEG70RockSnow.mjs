#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  G70_TERRAIN3D_ROCK_SNOW_POLICY,
  buildG70Terrain3DRockSnowProbe,
  measureG70Terrain3DRockSnow,
  sampleG70RockSnow,
} from '../godot/terrain-authoring/geocells/ne/g70_rock_snow.mjs';
import { g70GuardBounds } from '../godot/terrain-authoring/geocells/ne/g70_hydrology.mjs';
import { sampleG70Relief } from '../godot/terrain-authoring/geocells/ne/g70_relief.mjs';

const MAP_SHA = '20702972e8f45f0fbdc4da5fa68e890a82e4e822e1d58e2f369d8bc5b9c571a1';
const p = G70_TERRAIN3D_ROCK_SNOW_POLICY;
const a = measureG70Terrain3DRockSnow();
const b = measureG70Terrain3DRockSnow();
assert.deepEqual(a, b, 'G70 Rock/Snow metrics must be deterministic');
assert.equal(a.sourceMapSha256, MAP_SHA, 'map.png provenance drifted');
assert.equal(a.geoCell, 'G70');
assert.equal(a.layer, 'Rock/Snow');
assert.equal(a.canonicalWater, 96, 'G70 must remain 96/96 canonical water');
assert.equal(a.canonicalLand, 0, 'G70 Rock/Snow invented land');
assert.equal(a.sourceSamples, 4225);
assert.equal(a.nonSeaSamples, 0, 'guard-backed source invented non-sea semantics');
assert.equal(a.maxRockWeight, 0, 'rock leaked onto canonical sea');
assert.equal(a.maxSnowWeight, 0, 'snow leaked onto canonical sea');
assert.equal(a.maxTerrestrialSurfaceMass, 0, 'terrestrial material leaked onto canonical sea');
assert.equal(a.maxHeightMismatch, 0, 'Rock/Snow changed merged Relief height');
assert.equal(a.maxAdjacentBlendStep, 0, 'zero-overlay control field developed a local step');
assert.equal(a.maxGuardBlendDelta, 0, 'G60/G71 guard gained a material seam');
assert.equal(a.reliefMinHeight, a.reliefMaxHeight, 'G70 Relief no longer has canonical flat seafloor');
assert.equal(p.terrain3dImportSize, 257);
assert.equal(p.terrain3dRegionSize, 256);

const probeA = buildG70Terrain3DRockSnowProbe();
const probeB = buildG70Terrain3DRockSnowProbe();
assert.deepEqual(probeA, probeB, 'G70 Rock/Snow probe must be byte-deterministic');
assert.equal(probeA.rows.length, 65);
assert.ok(probeA.rows.every((row) => row.length === 65), 'unexpected probe dimensions');
for (const row of probeA.rows) for (const sample of row) {
  assert.equal(sample[0], 0, 'probe rock weight must stay zero');
  assert.equal(sample[1], 0, 'probe snow weight must stay zero');
  assert.equal(sample[2], 0, 'probe terrestrial mass must stay zero');
  assert.equal(sample[4], 0, 'probe Terrain3D control blend must stay zero');
}

// A denser owner-map envelope proves that the zero terrestrial gate is not an
// accident of 65x65 sample alignment. It crosses the west/south owner guards.
const bounds = g70GuardBounds();
let envelopeSamples = 0;
let envelopeNonSea = 0;
let envelopeRockLeak = 0;
let envelopeSnowLeak = 0;
let envelopeHeightMismatch = 0;
for (let y = 0; y < 129; y += 1) {
  const ny = bounds.yMin + (bounds.yMax - bounds.yMin) * y / 128;
  for (let x = 0; x < 129; x += 1) {
    const nx = bounds.xMin + (bounds.xMax - bounds.xMin) * x / 128;
    const s = sampleG70RockSnow(nx, ny);
    const relief = sampleG70Relief(nx, ny);
    envelopeSamples += 1;
    if (s.body !== 'sea' || !s.water) envelopeNonSea += 1;
    envelopeRockLeak = Math.max(envelopeRockLeak, Math.abs(s.rockWeight));
    envelopeSnowLeak = Math.max(envelopeSnowLeak, Math.abs(s.snowWeight));
    envelopeHeightMismatch = Math.max(envelopeHeightMismatch, Math.abs(s.heightMeters - relief.heightMeters));
  }
}
assert.equal(envelopeSamples, 16641);
assert.equal(envelopeNonSea, 0);
assert.equal(envelopeRockLeak, 0);
assert.equal(envelopeSnowLeak, 0);
assert.equal(envelopeHeightMismatch, 0);

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

// Preflight the exact 257x257 Terrain3D import domain. Height may be submerged,
// while every terrestrial control value must remain exactly zero after filtering.
let importSamples = 0;
let maxFilteredRock = 0, maxFilteredSnow = 0, maxFilteredBlend = 0;
let minFilteredHeight = Infinity, maxFilteredHeight = -Infinity;
for (let z = 0; z < 257; z += 1) for (let x = 0; x < 257; x += 1) {
  const u = x / 256, v = z / 256;
  maxFilteredRock = Math.max(maxFilteredRock, Math.abs(bilerp(0, u, v)));
  maxFilteredSnow = Math.max(maxFilteredSnow, Math.abs(bilerp(1, u, v)));
  maxFilteredBlend = Math.max(maxFilteredBlend, Math.abs(bilerp(4, u, v)));
  const h = bilerp(3, u, v);
  minFilteredHeight = Math.min(minFilteredHeight, h);
  maxFilteredHeight = Math.max(maxFilteredHeight, h);
  importSamples += 1;
}
assert.equal(importSamples, 66049);
assert.equal(maxFilteredRock, 0);
assert.equal(maxFilteredSnow, 0);
assert.equal(maxFilteredBlend, 0);
assert.ok(maxFilteredHeight < 0, 'filtered G70 seafloor escaped below-water contract');
assert.ok(maxFilteredHeight - minFilteredHeight <= 0.000001, 'filtered import invented bathymetric relief');

// Explicit seam preflight around the Terrain3D 255/256 region boundary.
const seam = [254.75, 255, 255.25, 255.5, 255.75, 256];
let seamSamples = 0, maxSeamBlend = 0, maxSeamHeightDelta = 0;
for (const edge of seam) for (const cross of [32.25, 96.5, 160.75, 224.5, 256]) {
  for (const [x, z] of [[edge, cross], [cross, edge]]) {
    maxSeamBlend = Math.max(maxSeamBlend, Math.abs(bilerp(4, x / 256, z / 256)));
    maxSeamHeightDelta = Math.max(maxSeamHeightDelta, Math.abs(bilerp(3, x / 256, z / 256) - probeA.rows[0][0][3]));
    seamSamples += 1;
  }
}
assert.equal(seamSamples, 60);
assert.equal(maxSeamBlend, 0);
assert.ok(maxSeamHeightDelta <= 0.000001);

const metrics = Object.freeze({
  ...a,
  envelopeSamples,
  envelopeNonSea,
  envelopeRockLeak,
  envelopeSnowLeak,
  envelopeHeightMismatch,
  importSamples,
  maxFilteredRock,
  maxFilteredSnow,
  maxFilteredBlend,
  minFilteredHeight,
  maxFilteredHeight,
  seamSamples,
  maxSeamBlend,
  maxSeamHeightDelta,
});
const emit = process.argv.find((arg) => arg.startsWith('--emit-probe='));
if (emit) {
  const output = path.resolve(emit.slice('--emit-probe='.length));
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify(probeA)}\n`, 'utf8');
}
console.log(`NE_G70_ROCK_SNOW_METRICS=${JSON.stringify(metrics)}`);
console.log('NE_G70_ROCK_SNOW_VALIDATION_OK');
