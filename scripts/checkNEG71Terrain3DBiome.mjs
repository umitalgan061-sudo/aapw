#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  G71_TERRAIN3D_BIOME_POLICY,
  buildG71Terrain3DBiomeSource,
  g71BiomeGuardBounds,
  g71BiomeNormalizedFromSource,
  g71BiomeOwnerCoordinates,
  measureG71NeighborSeaHalo,
  measureG71Terrain3DBiome,
  sampleG71Biome,
} from '../godot/terrain-authoring/geocells/ne/g71_biome.mjs';
import { measureG71Hydrology } from '../godot/terrain-authoring/geocells/ne/g71_hydrology.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PROOF_DIR = path.join(ROOT, 'godot/terrain-authoring/.terrain3d-proof');
const SOURCE_PATH = path.join(PROOF_DIR, 'g71-biome-source.json');
const MAP_SHA = '20702972e8f45f0fbdc4da5fa68e890a82e4e822e1d58e2f369d8bc5b9c571a1';
const p = G71_TERRAIN3D_BIOME_POLICY;

assert.deepEqual(
  measureG71Hydrology(),
  {
    policyId: 'safak-kartali-g71-hydrology-2026-08-12-v1', geoCell: 'G71', baseCells: 96,
    waterCells: 96, landCells: 0, seaCells: 96, lakeCells: 0, boundaryEdges: 0,
    semanticChecksum: 848461253, needsCoastInterpolation: false,
  },
  'merged G71 Coast/Hydrology drifted',
);
assert.equal(p.sourceMapSha256, MAP_SHA);
assert.equal(p.geoCell, 'G71');
assert.equal(p.layer, 'Macro Albedo/Biome');
assert.deepEqual(p.normalizedBounds, { xMin: 7 / 8, xMax: 1, yMin: 1 / 8, yMax: 2 / 8 });
assert.equal(p.guardNormalized, 1 / 384);
assert.equal(p.sourceGridSize, 65);
assert.equal(p.terrain3dImportSize, 257);
assert.equal(p.terrain3dRegionSize, 256);
assert.equal(p.heightMeters, -8);
assert.deepEqual(p.color, [0.16, 0.30, 0.36]);
assert.equal(p.roughness, 0.86);

const guard = g71BiomeGuardBounds();
assert.deepEqual(guard, { xMin: 7 / 8 - 1 / 384, xMax: 1, yMin: 1 / 8 - 1 / 384, yMax: 2 / 8 + 1 / 384 });
const halo = measureG71NeighborSeaHalo();
assert.equal(halo.samples, 32, 'G71 canonical guard halo sample count drifted');
assert.equal(halo.nonSeaSamples, 0, 'G71 guard halo must remain canonical open sea');
assert.deepEqual(halo.sides, ['west', 'north', 'south']);

const metricsA = measureG71Terrain3DBiome();
const metricsB = measureG71Terrain3DBiome();
assert.deepEqual(metricsA, metricsB, 'G71 biome metrics must be deterministic');
assert.deepEqual(
  {
    water: metricsA.canonicalWater, land: metricsA.canonicalLand, sea: metricsA.canonicalSea,
    lake: metricsA.canonicalLake, edges: metricsA.boundaryEdges, nonSea: metricsA.nonSeaSamples,
    haloNonSea: metricsA.haloNonSeaSamples,
  },
  { water: 96, land: 0, sea: 96, lake: 0, edges: 0, nonSea: 0, haloNonSea: 0 },
);
assert.equal(metricsA.samples, 4225);
assert.equal(metricsA.maxAdjacentColorDelta, 0);
assert.equal(metricsA.maxAdjacentRoughnessDelta, 0);
assert.ok(metricsA.maxCoordinateRoundTripError <= Number.EPSILON * 8);

for (const [x, y, u, v] of [
  [p.normalizedBounds.xMin, p.normalizedBounds.yMin, 0, 0],
  [p.normalizedBounds.xMax, p.normalizedBounds.yMin, 1, 0],
  [p.normalizedBounds.xMin, p.normalizedBounds.yMax, 0, 1],
  [p.normalizedBounds.xMax, p.normalizedBounds.yMax, 1, 1],
]) {
  const owner = g71BiomeOwnerCoordinates(x, y, { allowGuard: false });
  assert.equal(owner.insideOwner, true);
  assert.equal(owner.insideGuard, false);
  assert.equal(owner.u, u); assert.equal(owner.v, v);
  const sample = sampleG71Biome(x, y);
  assert.deepEqual(sample, { body: 'sea', water: true, waterConfidence: 1, heightMeters: -8, color: p.color, roughness: 0.86, dominantId: 'open-sea-floor' });
}

for (const [x, y] of [
  [p.normalizedBounds.xMin - p.guardNormalized / 2, (p.normalizedBounds.yMin + p.normalizedBounds.yMax) / 2],
  [(p.normalizedBounds.xMin + p.normalizedBounds.xMax) / 2, p.normalizedBounds.yMin - p.guardNormalized / 2],
  [(p.normalizedBounds.xMin + p.normalizedBounds.xMax) / 2, p.normalizedBounds.yMax + p.guardNormalized / 2],
]) {
  const owner = g71BiomeOwnerCoordinates(x, y);
  assert.equal(owner.insideOwner, false); assert.equal(owner.insideGuard, true);
  assert.equal(sampleG71Biome(x, y).body, 'sea');
  assert.throws(() => g71BiomeOwnerCoordinates(x, y, { allowGuard: false }), RangeError);
}
assert.throws(() => sampleG71Biome(1 + Number.EPSILON * 16, 0.2), RangeError, 'east guard must not escape world x=1');
assert.throws(() => sampleG71Biome(Number.NaN, 0.2), TypeError);
assert.throws(() => sampleG71Biome(0.9, Number.POSITIVE_INFINITY), TypeError);
assert.throws(() => g71BiomeNormalizedFromSource(1.5, 1), TypeError);
assert.throws(() => g71BiomeNormalizedFromSource(-1, 0), RangeError);
assert.throws(() => g71BiomeNormalizedFromSource(65, 64), RangeError);

const indexes = new Set();
let maxRoundTripError = 0;
for (let sy = 0; sy < p.sourceGridSize; sy += 1) for (let sx = 0; sx < p.sourceGridSize; sx += 1) {
  const c = g71BiomeNormalizedFromSource(sx, sy);
  assert.equal(c.linearIndex, sy * p.sourceGridSize + sx);
  assert.equal(indexes.has(c.linearIndex), false, 'G71 source index collision');
  indexes.add(c.linearIndex);
  const owner = g71BiomeOwnerCoordinates(c.normalizedX, c.normalizedY, { allowGuard: false });
  maxRoundTripError = Math.max(maxRoundTripError, Math.abs(owner.u - c.u), Math.abs(owner.v - c.v));
  const s = sampleG71Biome(c.normalizedX, c.normalizedY);
  assert.equal(s.body, 'sea'); assert.equal(s.waterConfidence, 1); assert.equal(s.heightMeters, -8);
  assert.deepEqual(s.color, p.color); assert.equal(s.roughness, 0.86);
}
assert.equal(indexes.size, 4225);
assert.ok(maxRoundTripError <= Number.EPSILON * 8);

const sourceA = buildG71Terrain3DBiomeSource();
const sourceB = buildG71Terrain3DBiomeSource();
assert.deepEqual(sourceA, sourceB, 'G71 source must be deterministic');
assert.equal(sourceA.schema, 'westeros-g71-terrain3d-biome-source-v1');
assert.equal(sourceA.sourceChecksum, metricsA.sourceChecksum, 'source/measure checksum diverged');
assert.equal(Object.isFrozen(sourceA), true);
for (const name of ['heights', 'waterConfidence', 'colorR', 'colorG', 'colorB', 'roughness']) {
  assert.equal(sourceA[name].length, 4225); assert.equal(Object.isFrozen(sourceA[name]), true);
  assert.ok(sourceA[name].every(Number.isFinite), `${name} contains non-finite data`);
}
assert.ok(sourceA.heights.every((v) => v === -8));
assert.ok(sourceA.waterConfidence.every((v) => v === 1));
assert.ok(sourceA.colorR.every((v) => v === 0.16));
assert.ok(sourceA.colorG.every((v) => v === 0.30));
assert.ok(sourceA.colorB.every((v) => v === 0.36));
assert.ok(sourceA.roughness.every((v) => v === 0.86));
const encodedA = JSON.stringify(sourceA); const encodedB = JSON.stringify(sourceB);
assert.equal(encodedA, encodedB); assert.equal(encodedA.includes('NaN'), false); assert.equal(encodedA.includes('Infinity'), false);
fs.mkdirSync(PROOF_DIR, { recursive: true });
fs.writeFileSync(SOURCE_PATH, `${encodedA}\n`, 'utf8');
console.log(`G71_TERRAIN3D_BIOME_METRICS=${JSON.stringify(metricsA)}`);
console.log(`G71_TERRAIN3D_BIOME_SOURCE=${JSON.stringify({ samples: indexes.size, checksum: sourceA.sourceChecksum, maxRoundTripError })}`);
console.log('NE_G71_TERRAIN3D_BIOME_SOURCE_OK');
