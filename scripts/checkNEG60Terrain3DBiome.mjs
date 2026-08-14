#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  G60_TERRAIN3D_BIOME_POLICY,
  buildG60Terrain3DBiomeSource,
  g60BiomeNormalizedFromSource,
  g60BiomeOwnerCoordinates,
  measureG60Terrain3DBiome,
  sampleG60Biome,
  sampleG60BiomeSourcePoint,
} from '../godot/terrain-authoring/geocells/ne/g60_biome.mjs';
import { measureG60Hydrology } from '../godot/terrain-authoring/geocells/ne/g60_hydrology.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PROOF_DIR = path.join(ROOT, 'godot/terrain-authoring/.terrain3d-proof');
const SOURCE_PATH = path.join(PROOF_DIR, 'g60-biome-source.json');
const MAP_SHA = '20702972e8f45f0fbdc4da5fa68e890a82e4e822e1d58e2f369d8bc5b9c571a1';

const hydrology = measureG60Hydrology();
assert.deepEqual(
  { water: hydrology.waterCells, land: hydrology.landCells, sea: hydrology.seaCells, lake: hydrology.lakeCells, edges: hydrology.boundaryEdges },
  { water: 96, land: 0, sea: 96, lake: 0, edges: 0 },
  'merged G60 Coast/Hydrology drifted',
);
assert.equal(G60_TERRAIN3D_BIOME_POLICY.sourceMapSha256, MAP_SHA);
assert.equal(G60_TERRAIN3D_BIOME_POLICY.layer, 'Macro Albedo/Biome');
assert.equal(G60_TERRAIN3D_BIOME_POLICY.sourceGridSize, 65);
assert.equal(G60_TERRAIN3D_BIOME_POLICY.terrain3dImportSize, 257);
assert.equal(G60_TERRAIN3D_BIOME_POLICY.terrain3dRegionSize, 256);
assert.equal(G60_TERRAIN3D_BIOME_POLICY.guardNormalized, 1 / 384);

const first = measureG60Terrain3DBiome();
const second = measureG60Terrain3DBiome();
assert.deepEqual(first, second, 'G60 biome metrics must be deterministic');
assert.equal(first.canonicalWater, 96);
assert.equal(first.canonicalLand, 0);
assert.equal(first.canonicalSea, 96);
assert.equal(first.boundaryEdges, 0);
assert.equal(first.samples, 65 * 65);
assert.equal(first.nonSeaSamples, 0);
assert.equal(first.maxAdjacentColorDelta, 0);
assert.equal(first.maxAdjacentRoughnessDelta, 0);
assert.ok(first.maxCoordinateRoundTripError <= Number.EPSILON * 4);
assert.ok(Number.isInteger(first.coordinateChecksum));

const p = G60_TERRAIN3D_BIOME_POLICY;
const ownerCorners = [
  [p.normalizedBounds.xMin, p.normalizedBounds.yMin, 0, 0],
  [p.normalizedBounds.xMax, p.normalizedBounds.yMin, 1, 0],
  [p.normalizedBounds.xMin, p.normalizedBounds.yMax, 0, 1],
  [p.normalizedBounds.xMax, p.normalizedBounds.yMax, 1, 1],
];
for (const [x, y, expectedU, expectedV] of ownerCorners) {
  const owner = g60BiomeOwnerCoordinates(x, y, { allowGuard: false });
  assert.equal(owner.insideOwner, true);
  assert.equal(owner.insideGuard, false);
  assert.equal(owner.u, expectedU);
  assert.equal(owner.v, expectedV);
  assert.equal(owner.clampedU, expectedU);
  assert.equal(owner.clampedV, expectedV);
  const sample = sampleG60Biome(x, y);
  assert.equal(sample.body, 'sea');
  assert.equal(sample.waterConfidence, 1);
  assert.ok(sample.heightMeters <= -2.5);
}

for (const [x, y] of [
  [p.normalizedBounds.xMin - p.guardNormalized / 2, p.normalizedBounds.yMin],
  [p.normalizedBounds.xMax + p.guardNormalized / 2, p.normalizedBounds.yMax],
  [p.normalizedBounds.xMin, p.normalizedBounds.yMax + p.guardNormalized / 2],
]) {
  const guarded = g60BiomeOwnerCoordinates(x, y);
  assert.equal(guarded.insideOwner, false);
  assert.equal(guarded.insideGuard, true);
  assert.ok(guarded.clampedU >= 0 && guarded.clampedU <= 1);
  assert.ok(guarded.clampedV >= 0 && guarded.clampedV <= 1);
  assert.equal(sampleG60Biome(x, y).body, 'sea');
  assert.throws(() => g60BiomeOwnerCoordinates(x, y, { allowGuard: false }), RangeError);
}

for (const [x, y] of [
  [p.normalizedBounds.xMin - p.guardNormalized - 1e-8, p.normalizedBounds.yMin],
  [p.normalizedBounds.xMax + p.guardNormalized + 1e-8, p.normalizedBounds.yMin],
  [p.normalizedBounds.xMin, p.normalizedBounds.yMax + p.guardNormalized + 1e-8],
]) {
  assert.throws(() => sampleG60Biome(x, y), RangeError);
}
assert.throws(() => sampleG60Biome(Number.NaN, p.normalizedBounds.yMin), TypeError);
assert.throws(() => sampleG60Biome(p.normalizedBounds.xMin, Number.POSITIVE_INFINITY), TypeError);
assert.throws(() => g60BiomeNormalizedFromSource(1.5, 2), TypeError);
assert.throws(() => g60BiomeNormalizedFromSource(-1, 0), RangeError);
assert.throws(() => g60BiomeNormalizedFromSource(65, 64), RangeError);

const visitedIndexes = new Set();
let maxSourceRoundTripError = 0;
for (let sourceY = 0; sourceY < p.sourceGridSize; sourceY += 1) {
  for (let sourceX = 0; sourceX < p.sourceGridSize; sourceX += 1) {
    const coordinates = g60BiomeNormalizedFromSource(sourceX, sourceY);
    assert.equal(coordinates.linearIndex, sourceY * p.sourceGridSize + sourceX);
    assert.equal(visitedIndexes.has(coordinates.linearIndex), false, 'source linear index collided');
    visitedIndexes.add(coordinates.linearIndex);
    const owner = g60BiomeOwnerCoordinates(coordinates.normalizedX, coordinates.normalizedY, { allowGuard: false });
    maxSourceRoundTripError = Math.max(
      maxSourceRoundTripError,
      Math.abs(owner.u - coordinates.u),
      Math.abs(owner.v - coordinates.v),
    );
    const sample = sampleG60BiomeSourcePoint(sourceX, sourceY);
    assert.equal(sample.sourceX, sourceX);
    assert.equal(sample.sourceY, sourceY);
    assert.equal(sample.linearIndex, coordinates.linearIndex);
    assert.equal(sample.body, 'sea');
    assert.equal(sample.water, true);
    assert.equal(sample.waterConfidence, 1);
    assert.equal(sample.heightMeters, -8);
    assert.deepEqual(sample.color, p.color);
    assert.equal(sample.roughness, 0.86);
  }
}
assert.equal(visitedIndexes.size, 65 * 65);
assert.ok(maxSourceRoundTripError <= Number.EPSILON * 4);

for (let yi = 0; yi <= 8; yi += 1) {
  for (let xi = 0; xi <= 8; xi += 1) {
    const u = xi / 8;
    const v = yi / 8;
    const x = p.normalizedBounds.xMin + (p.normalizedBounds.xMax - p.normalizedBounds.xMin) * u;
    const y = p.normalizedBounds.yMin + (p.normalizedBounds.yMax - p.normalizedBounds.yMin) * v;
    const owner = g60BiomeOwnerCoordinates(x, y, { allowGuard: false });
    assert.ok(Math.abs(owner.u - u) <= Number.EPSILON * 2);
    assert.ok(Math.abs(owner.v - v) <= Number.EPSILON * 2);
    const sample = sampleG60Biome(x, y);
    assert.equal(sample.dominantId, 'open-sea-floor');
    assert.equal(sample.body, 'sea');
  }
}

const sourceA = buildG60Terrain3DBiomeSource();
const sourceB = buildG60Terrain3DBiomeSource();
assert.deepEqual(sourceA, sourceB, 'G60 Terrain3D source must be deterministic');
assert.equal(sourceA.schema, 'westeros-g60-terrain3d-biome-source-v1');
assert.deepEqual(sourceA.normalizedBounds, p.normalizedBounds);
assert.equal(sourceA.guardNormalized, p.guardNormalized);
assert.equal(Object.isFrozen(sourceA), true);
for (const channel of ['heights', 'waterConfidence', 'colorR', 'colorG', 'colorB', 'roughness']) {
  assert.equal(sourceA[channel].length, 65 * 65, `G60 source channel ${channel} size drifted`);
  assert.equal(Object.isFrozen(sourceA[channel]), true, `G60 source channel ${channel} must be immutable`);
  assert.ok(sourceA[channel].every(Number.isFinite), `G60 source channel ${channel} contains a non-finite value`);
}
assert.ok(sourceA.heights.every((value) => value === -8));
assert.ok(sourceA.heights.every((value) => value <= -2.5));
assert.ok(sourceA.waterConfidence.every((value) => value === 1));
assert.ok(sourceA.colorR.every((value) => value === 0.16));
assert.ok(sourceA.colorG.every((value) => value === 0.30));
assert.ok(sourceA.colorB.every((value) => value === 0.36));
assert.ok(sourceA.roughness.every((value) => value === 0.86));
assert.ok(Number.isInteger(sourceA.sourceChecksum));
assert.equal(sourceA.sourceChecksum, first.sourceChecksum, 'source builder and measured source checksum diverged');

const encodedA = JSON.stringify(sourceA);
const encodedB = JSON.stringify(sourceB);
assert.equal(encodedA, encodedB, 'serialized G60 Terrain3D source must be byte-deterministic');
assert.equal(encodedA.includes('NaN'), false);
assert.equal(encodedA.includes('Infinity'), false);

fs.mkdirSync(PROOF_DIR, { recursive: true });
fs.writeFileSync(SOURCE_PATH, `${encodedA}\n`, 'utf8');
console.log(`G60_TERRAIN3D_BIOME_METRICS=${JSON.stringify(first)}`);
console.log(`G60_TERRAIN3D_BIOME_COORDINATES=${JSON.stringify({ sourceSamples: visitedIndexes.size, maxSourceRoundTripError })}`);
console.log(`G60_TERRAIN3D_BIOME_SOURCE=${JSON.stringify({ samples: sourceA.heights.length, checksum: sourceA.sourceChecksum })}`);
console.log('NE_G60_TERRAIN3D_BIOME_SOURCE_OK');
