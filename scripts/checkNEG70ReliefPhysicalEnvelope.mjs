#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  buildG70Terrain3DReliefSource,
  sampleG70Relief,
} from '../godot/terrain-authoring/geocells/ne/g70_relief.mjs';
import {
  g70GuardBounds,
  sampleG70Hydrology,
} from '../godot/terrain-authoring/geocells/ne/g70_hydrology.mjs';
import { sampleG70Biome } from '../godot/terrain-authoring/geocells/ne/g70_biome.mjs';

const source = buildG70Terrain3DReliefSource();
const guard = g70GuardBounds();
const core = source.coreBounds;
const lerp = (a, b, t) => a + (b - a) * t;
let checksum = 2166136261;
const hash = (value) => {
  const q = Math.round((value + 128) * 1000000) | 0;
  for (const shift of [0, 8, 16, 24]) checksum = Math.imul((checksum ^ ((q >>> shift) & 0xff)) >>> 0, 16777619) >>> 0;
};

let denseSamples = 0;
let maxHydrologyDelta = 0;
let maxBiomeDelta = 0;
let maxAddedRelief = 0;
let maxNormalDelta = 0;
let minHeight = Infinity;
let maxHeight = -Infinity;
for (let y = 0; y < 129; y += 1) {
  const ny = lerp(guard.yMin, guard.yMax, y / 128);
  for (let x = 0; x < 129; x += 1) {
    const nx = lerp(guard.xMin, guard.xMax, x / 128);
    const relief = sampleG70Relief(nx, ny);
    const hydrology = sampleG70Hydrology(nx, ny);
    const biome = sampleG70Biome(nx, ny);
    assert.equal(relief.body, 'sea', `dense envelope invented non-sea at ${x},${y}`);
    maxHydrologyDelta = Math.max(maxHydrologyDelta, Math.abs(relief.heightMeters - hydrology.heightMeters));
    maxBiomeDelta = Math.max(maxBiomeDelta, Math.abs(relief.heightMeters - biome.heightMeters));
    maxAddedRelief = Math.max(maxAddedRelief, Math.abs(relief.addedReliefMeters));
    maxNormalDelta = Math.max(maxNormalDelta, Math.hypot(relief.normal.x, relief.normal.y - 1, relief.normal.z));
    minHeight = Math.min(minHeight, relief.heightMeters);
    maxHeight = Math.max(maxHeight, relief.heightMeters);
    hash(relief.heightMeters);
    denseSamples += 1;
  }
}
assert.equal(maxHydrologyDelta, 0, '129x129 envelope left merged Hydrology');
assert.equal(maxBiomeDelta, 0, '129x129 envelope left merged Biome height provenance');
assert.equal(maxAddedRelief, 0, '129x129 envelope invented submarine relief');
assert.equal(maxNormalDelta, 0, '129x129 envelope invented non-flat seafloor normals');
assert.equal(maxHeight - minHeight, 0, '129x129 envelope gained synthetic height span');

function sourceHeight(u, v) {
  const gx = Math.max(0, Math.min(1, u)) * (source.width - 1);
  const gy = Math.max(0, Math.min(1, v)) * (source.height - 1);
  const x0 = Math.floor(gx);
  const y0 = Math.floor(gy);
  const x1 = Math.min(x0 + 1, source.width - 1);
  const y1 = Math.min(y0 + 1, source.height - 1);
  const tx = gx - x0;
  const ty = gy - y0;
  const a = source.heights[y0 * source.width + x0];
  const b = source.heights[y0 * source.width + x1];
  const c = source.heights[y1 * source.width + x0];
  const d = source.heights[y1 * source.width + x1];
  return lerp(lerp(a, b, tx), lerp(c, d, tx), ty);
}

let importSamples = 0;
let importMin = Infinity;
let importMax = -Infinity;
let importChecksum = 2166136261;
for (let z = 0; z < 257; z += 1) {
  for (let x = 0; x < 257; x += 1) {
    const height = sourceHeight(x / 256, z / 256);
    assert.ok(Number.isFinite(height), `257 import preflight produced non-finite height at ${x},${z}`);
    importMin = Math.min(importMin, height);
    importMax = Math.max(importMax, height);
    const q = Math.round((height + 128) * 1000) | 0;
    importChecksum = Math.imul((importChecksum ^ q) >>> 0, 16777619) >>> 0;
    importSamples += 1;
  }
}
assert.equal(importSamples, 257 * 257, '257x257 import preflight sample count changed');
assert.equal(importMax - importMin, 0, 'bilinear 257x257 preflight invented height variation');
assert.equal(importMin, source.heights[0], '257x257 preflight changed canonical G70 seafloor');

const seamAxis = [254.5, 255, 255.5, 256];
const crossAxis = [0, 32.25, 64, 96.5, 128, 160.75, 192, 224.5, 256];
let seamSamples = 0;
let maxSeamDelta = 0;
for (const boundary of seamAxis) {
  for (const cross of crossAxis) {
    const vertical = sourceHeight(boundary / 256, cross / 256);
    const horizontal = sourceHeight(cross / 256, boundary / 256);
    maxSeamDelta = Math.max(maxSeamDelta, Math.abs(vertical - source.heights[0]), Math.abs(horizontal - source.heights[0]));
    seamSamples += 2;
  }
}
for (const z of seamAxis) {
  for (const x of seamAxis) {
    maxSeamDelta = Math.max(maxSeamDelta, Math.abs(sourceHeight(x / 256, z / 256) - source.heights[0]));
    seamSamples += 1;
  }
}
assert.equal(maxSeamDelta, 0, 'source interpolation developed a 255/256 seam before Terrain3D import');

let edgeSamples = 0;
let maxOwnerEdgeDelta = 0;
for (let i = 0; i < 129; i += 1) {
  const t = i / 128;
  const ny = lerp(core.yMin, core.yMax, t);
  const nx = lerp(core.xMin, core.xMax, t);
  const westCore = sampleG70Relief(core.xMin, ny).heightMeters;
  const westGuard = sampleG70Relief(guard.xMin, ny).heightMeters;
  const southCore = sampleG70Relief(nx, core.yMax).heightMeters;
  const southGuard = sampleG70Relief(nx, guard.yMax).heightMeters;
  maxOwnerEdgeDelta = Math.max(maxOwnerEdgeDelta, Math.abs(westCore - westGuard), Math.abs(southCore - southGuard));
  edgeSamples += 2;
}
assert.equal(maxOwnerEdgeDelta, 0, 'G70 owner-map west/south guard developed relief discontinuity');

const metrics = Object.freeze({
  schema: 'westeros-g70-relief-physical-envelope-v1',
  sourceMapSha256: source.sourceMapSha256,
  canonicalHeight: source.heights[0],
  denseSamples,
  denseHeightSpan: Number((maxHeight - minHeight).toFixed(8)),
  maxHydrologyDelta,
  maxBiomeDelta,
  maxAddedRelief,
  maxNormalDelta,
  denseChecksum: checksum >>> 0,
  importSamples,
  importHeightSpan: Number((importMax - importMin).toFixed(8)),
  importChecksum: importChecksum >>> 0,
  seamSamples,
  maxSeamDelta,
  edgeSamples,
  maxOwnerEdgeDelta,
});
const outArg = process.argv.find((arg) => arg.startsWith('--out='));
if (outArg) {
  const output = path.resolve(outArg.slice('--out='.length));
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify(metrics, null, 2)}\n`, 'utf8');
}
console.log(`NE_G70_RELIEF_PHYSICAL_ENVELOPE=${JSON.stringify(metrics)}`);
console.log('NE_G70_RELIEF_PHYSICAL_ENVELOPE_OK');
