#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  G60_TERRAIN3D_BIOME_POLICY,
  buildG60Terrain3DBiomeSource,
  measureG60Terrain3DBiome,
  sampleG60Biome,
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

const p = G60_TERRAIN3D_BIOME_POLICY;
for (const [x, y] of [
  [p.normalizedBounds.xMin, p.normalizedBounds.yMin],
  [p.normalizedBounds.xMax, p.normalizedBounds.yMin],
  [p.normalizedBounds.xMin, p.normalizedBounds.yMax],
  [p.normalizedBounds.xMax, p.normalizedBounds.yMax],
]) {
  const sample = sampleG60Biome(x, y);
  assert.equal(sample.body, 'sea');
  assert.equal(sample.waterConfidence, 1);
  assert.ok(sample.heightMeters <= -2.5);
}

const sourceA = buildG60Terrain3DBiomeSource();
const sourceB = buildG60Terrain3DBiomeSource();
assert.deepEqual(sourceA, sourceB, 'G60 Terrain3D source must be deterministic');
assert.equal(sourceA.schema, 'westeros-g60-terrain3d-biome-source-v1');
for (const channel of ['heights', 'waterConfidence', 'colorR', 'colorG', 'colorB', 'roughness']) {
  assert.equal(sourceA[channel].length, 65 * 65, `G60 source channel ${channel} size drifted`);
}
assert.ok(sourceA.heights.every((value) => value === -8));
assert.ok(sourceA.waterConfidence.every((value) => value === 1));
assert.ok(sourceA.roughness.every((value) => value === 0.86));
assert.ok(Number.isInteger(sourceA.sourceChecksum));

fs.mkdirSync(PROOF_DIR, { recursive: true });
fs.writeFileSync(SOURCE_PATH, `${JSON.stringify(sourceA)}\n`, 'utf8');
console.log(`G60_TERRAIN3D_BIOME_METRICS=${JSON.stringify(first)}`);
console.log(`G60_TERRAIN3D_BIOME_SOURCE=${JSON.stringify({ samples: sourceA.heights.length, checksum: sourceA.sourceChecksum })}`);
console.log('NE_G60_TERRAIN3D_BIOME_SOURCE_OK');
