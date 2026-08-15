#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  G71_TERRAIN3D_RELIEF_POLICY,
  buildG71Terrain3DReliefSource,
  g71ReliefGuardBounds,
  measureG71Terrain3DRelief,
  sampleG71Relief,
} from '../godot/terrain-authoring/geocells/ne/g71_relief.mjs';
import {
  G71_TERRAIN3D_BIOME_POLICY,
  g71BiomeOwnerCoordinates,
  measureG71NeighborSeaHalo,
  measureG71Terrain3DBiome,
  sampleG71Biome,
} from '../godot/terrain-authoring/geocells/ne/g71_biome.mjs';
import { measureG71Hydrology } from '../godot/terrain-authoring/geocells/ne/g71_hydrology.mjs';
import { measureG61Hydrology } from '../godot/terrain-authoring/geocells/ne/g61_hydrology.mjs';
import { sampleG70Relief } from '../godot/terrain-authoring/geocells/ne/g70_relief.mjs';

const MAP_SHA = '20702972e8f45f0fbdc4da5fa68e890a82e4e822e1d58e2f369d8bc5b9c571a1';
const p = G71_TERRAIN3D_RELIEF_POLICY;
const first = measureG71Terrain3DRelief();
const second = measureG71Terrain3DRelief();
assert.deepEqual(first, second, 'G71 Relief metrics must be deterministic');
assert.equal(first.sourceMapSha256, MAP_SHA);
assert.equal(first.geoCell, 'G71');
assert.equal(first.layer, 'Relief/Height Character');
assert.deepEqual(
  { water: first.canonicalWater, land: first.canonicalLand, sea: first.canonicalSea, lake: first.canonicalLake, edges: first.boundaryEdges },
  { water: 96, land: 0, sea: 96, lake: 0, edges: 0 },
  'G71 canonical geography drifted',
);
assert.equal(first.priorBiomeCanonicalSea, 96);
assert.equal(first.haloSamples, 32);
assert.equal(first.haloNonSeaSamples, 0);
assert.equal(first.samples, 65 * 65);
assert.equal(first.nonSeaSamples, 0);
assert.equal(first.biomeMismatchSamples, 0);
assert.equal(first.addedReliefAbsMax, 0);
assert.equal(first.minHeight, G71_TERRAIN3D_BIOME_POLICY.heightMeters);
assert.equal(first.maxHeight, G71_TERRAIN3D_BIOME_POLICY.heightMeters);
assert.equal(first.heightSpan, 0);
assert.equal(first.maxAdjacentHeightDelta, 0);
assert.equal(first.maxGuardHeightDelta, 0);
assert.equal(first.maxGuardNormalDelta, 0);
assert.equal(first.guardPairs, 65 * 3);
assert.equal(first.maxCoordinateRoundTripError, 0);
assert.equal(first.eastWorldBoundaryX, 1);
assert.equal(first.eastGuardAllowed, false);
assert.ok(first.worldWidthMeters > 13000 && first.worldDepthMeters > 10000);
assert.equal(p.syntheticReliefMeters, 0);
assert.equal(p.terrain3dImportSize, 257);
assert.equal(p.terrain3dRegionSize, 256);

const hydrology = measureG71Hydrology();
const biome = measureG71Terrain3DBiome();
const halo = measureG71NeighborSeaHalo();
const west = measureG61Hydrology();
assert.equal(hydrology.waterCells, 96);
assert.equal(hydrology.landCells, 0);
assert.equal(biome.canonicalSea, 96);
assert.equal(biome.nonSeaSamples, 0);
assert.equal(halo.nonSeaSamples, 0, 'G71 west/north/south canonical halo is no longer all sea');
assert.equal(west.seaCells, 96, 'west neighbor G61 is no longer canonical sea');
assert.equal(west.landCells, 0, 'west neighbor G61 gained canonical land');

const sourceA = buildG71Terrain3DReliefSource();
const sourceB = buildG71Terrain3DReliefSource();
assert.deepEqual(sourceA, sourceB, 'G71 Terrain3D Relief source must be deterministic');
assert.equal(sourceA.schema, 'westeros-g71-terrain3d-relief-source-v1');
assert.equal(sourceA.policyId, p.id);
assert.equal(sourceA.biomePolicyId, G71_TERRAIN3D_BIOME_POLICY.id);
assert.equal(sourceA.sourceMapSha256, MAP_SHA);
assert.equal(sourceA.width, 65);
assert.equal(sourceA.height, 65);
assert.equal(sourceA.heights.length, 65 * 65);
assert.equal(Object.isFrozen(sourceA), true);
assert.equal(Object.isFrozen(sourceA.heights), true);
assert.ok(sourceA.heights.every((height) => height === -8));
assert.ok(Number.isInteger(sourceA.sourceChecksum));
assert.equal(JSON.stringify(sourceA), JSON.stringify(sourceB));

const core = p.normalizedBounds;
const guard = g71ReliefGuardBounds();
const g = p.guardNormalized;
for (const [x, y] of [
  [core.xMin - g / 2, (core.yMin + core.yMax) / 2],
  [(core.xMin + core.xMax) / 2, core.yMin - g / 2],
  [(core.xMin + core.xMax) / 2, core.yMax + g / 2],
]) {
  const sample = sampleG71Relief(x, y);
  assert.equal(sample.insideGuard, true);
  assert.equal(sample.heightMeters, -8);
}
assert.throws(() => sampleG71Relief(core.xMax + 1e-8, core.yMin), RangeError, 'east world boundary must not grow a guard');
assert.throws(() => sampleG71Relief(guard.xMin - 1e-8, core.yMin), RangeError);
assert.throws(() => sampleG71Relief(core.xMin, guard.yMin - 1e-8), RangeError);
assert.throws(() => sampleG71Relief(core.xMin, guard.yMax + 1e-8), RangeError);
assert.throws(() => sampleG71Relief(Number.NaN, core.yMin), TypeError);
assert.throws(() => sampleG71Relief(core.xMin, Number.POSITIVE_INFINITY), TypeError);

const lerp = (a, b, t) => a + (b - a) * t;
let denseSamples = 0;
let denseMin = Infinity;
let denseMax = -Infinity;
let maxBiomeDelta = 0;
let maxNormalDelta = 0;
let maxCoordinateError = 0;
let denseChecksum = 2166136261;
function hashHeight(checksum, height) {
  const q = Math.round((height + 128) * 1000000) | 0;
  let out = checksum;
  for (const shift of [0, 8, 16, 24]) out = Math.imul((out ^ ((q >>> shift) & 0xff)) >>> 0, 16777619) >>> 0;
  return out >>> 0;
}
for (let y = 0; y < p.denseEnvelopeSize; y += 1) {
  const ny = lerp(guard.yMin, guard.yMax, y / (p.denseEnvelopeSize - 1));
  for (let x = 0; x < p.denseEnvelopeSize; x += 1) {
    const nx = lerp(guard.xMin, guard.xMax, x / (p.denseEnvelopeSize - 1));
    const relief = sampleG71Relief(nx, ny);
    const macro = sampleG71Biome(nx, ny);
    const owner = g71BiomeOwnerCoordinates(nx, ny, { allowGuard: true });
    assert.equal(relief.body, 'sea');
    maxBiomeDelta = Math.max(maxBiomeDelta, Math.abs(relief.heightMeters - macro.heightMeters));
    maxNormalDelta = Math.max(maxNormalDelta, Math.hypot(relief.normal.x, relief.normal.y - 1, relief.normal.z));
    maxCoordinateError = Math.max(maxCoordinateError, Math.abs(owner.normalizedX - nx), Math.abs(owner.normalizedY - ny));
    denseMin = Math.min(denseMin, relief.heightMeters);
    denseMax = Math.max(denseMax, relief.heightMeters);
    denseChecksum = hashHeight(denseChecksum, relief.heightMeters);
    denseSamples += 1;
  }
}
assert.equal(denseSamples, 129 * 129);
assert.equal(denseMax - denseMin, 0);
assert.equal(maxBiomeDelta, 0);
assert.equal(maxNormalDelta, 0);
assert.equal(maxCoordinateError, 0);

function sourceHeight(u, v) {
  const gx = Math.max(0, Math.min(1, u)) * 64;
  const gy = Math.max(0, Math.min(1, v)) * 64;
  const x0 = Math.floor(gx), y0 = Math.floor(gy);
  const x1 = Math.min(x0 + 1, 64), y1 = Math.min(y0 + 1, 64);
  const tx = gx - x0, ty = gy - y0;
  const h = sourceA.heights;
  return lerp(
    lerp(h[y0 * 65 + x0], h[y0 * 65 + x1], tx),
    lerp(h[y1 * 65 + x0], h[y1 * 65 + x1], tx), ty,
  );
}
let importSamples = 0;
let importMin = Infinity;
let importMax = -Infinity;
let importChecksum = 2166136261;
for (let z = 0; z < 257; z += 1) for (let x = 0; x < 257; x += 1) {
  const height = sourceHeight(x / 256, z / 256);
  assert.ok(Number.isFinite(height));
  importMin = Math.min(importMin, height);
  importMax = Math.max(importMax, height);
  importChecksum = hashHeight(importChecksum, height);
  importSamples += 1;
}
assert.equal(importSamples, 257 * 257);
assert.equal(importMax - importMin, 0);
assert.equal(importMin, -8);

const seamAxis = [254.5, 255, 255.5, 256];
const crossAxis = [0, 32.25, 64, 96.5, 128, 160.75, 192, 224.5, 256];
let seamSamples = 0;
let maxPreflightSeamDelta = 0;
for (const boundary of seamAxis) for (const cross of crossAxis) {
  maxPreflightSeamDelta = Math.max(maxPreflightSeamDelta, Math.abs(sourceHeight(boundary / 256, cross / 256) + 8), Math.abs(sourceHeight(cross / 256, boundary / 256) + 8));
  seamSamples += 2;
}
assert.equal(maxPreflightSeamDelta, 0);

let northNeighborSamples = 0;
let maxNorthNeighborDelta = 0;
for (let i = 0; i < 129; i += 1) {
  const nx = lerp(core.xMin, core.xMax, i / 128);
  maxNorthNeighborDelta = Math.max(maxNorthNeighborDelta, Math.abs(sampleG71Relief(nx, core.yMin).heightMeters - sampleG70Relief(nx, core.yMin).heightMeters));
  northNeighborSamples += 1;
}
assert.equal(northNeighborSamples, 129);
assert.equal(maxNorthNeighborDelta, 0, 'G70/G71 shared north edge height diverged');

const envelope = Object.freeze({
  denseSamples, denseHeightSpan: denseMax - denseMin, maxBiomeDelta, maxNormalDelta, maxCoordinateError,
  denseChecksum: denseChecksum >>> 0, importSamples, importHeightSpan: importMax - importMin,
  importChecksum: importChecksum >>> 0, seamSamples, maxPreflightSeamDelta,
  northNeighborSamples, maxNorthNeighborDelta, haloSamples: halo.samples, haloNonSeaSamples: halo.nonSeaSamples,
  eastWorldBoundaryRejected: true,
});
const emitArg = process.argv.find((arg) => arg.startsWith('--emit-source='));
if (emitArg) {
  const output = path.resolve(emitArg.slice('--emit-source='.length));
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify(sourceA)}\n`, 'utf8');
}
console.log(`NE_G71_RELIEF_METRICS=${JSON.stringify(first)}`);
console.log(`NE_G71_RELIEF_SOURCE=${JSON.stringify({ samples: sourceA.heights.length, heightMeters: sourceA.heights[0], sourceChecksum: sourceA.sourceChecksum })}`);
console.log(`NE_G71_RELIEF_PHYSICAL_ENVELOPE=${JSON.stringify(envelope)}`);
console.log('NE_G71_RELIEF_VALIDATION_OK');
