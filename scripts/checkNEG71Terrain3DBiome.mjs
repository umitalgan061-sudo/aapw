#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { measureG71Hydrology } from '../godot/terrain-authoring/geocells/ne/g71_hydrology.mjs';
import { G71_TERRAIN3D_BIOME_POLICY, buildG71Terrain3DBiomeSource, measureG71Terrain3DBiome } from '../godot/terrain-authoring/geocells/ne/g71_biome.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PROOF_DIR = path.join(ROOT, 'godot/terrain-authoring/.terrain3d-proof');
const SOURCE_PATH = path.join(PROOF_DIR, 'g71-biome-source.json');
const MAP_SHA = '20702972e8f45f0fbdc4da5fa68e890a82e4e822e1d58e2f369d8bc5b9c571a1';

assert.equal(G71_TERRAIN3D_BIOME_POLICY.geoCell, 'G71');
assert.equal(G71_TERRAIN3D_BIOME_POLICY.layer, 'Macro Albedo/Biome');
assert.equal(G71_TERRAIN3D_BIOME_POLICY.sourceMapSha256, MAP_SHA);
assert.equal(G71_TERRAIN3D_BIOME_POLICY.sourceGridSize, 65);
assert.equal(G71_TERRAIN3D_BIOME_POLICY.terrain3dImportSize, 257);
assert.equal(G71_TERRAIN3D_BIOME_POLICY.terrain3dRegionSize, 256);

const hydrology = measureG71Hydrology();
assert.deepEqual({ water: hydrology.waterCells, land: hydrology.landCells, sea: hydrology.seaCells, lake: hydrology.lakeCells, edges: hydrology.boundaryEdges }, { water: 96, land: 0, sea: 96, lake: 0, edges: 0 });

const a = measureG71Terrain3DBiome();
const b = measureG71Terrain3DBiome();
assert.deepEqual(a, b, 'G71 biome metrics must be deterministic');
assert.equal(a.canonicalSea, 96);
assert.equal(a.canonicalLand, 0);
assert.equal(a.denseNonSeaSamples, 0);
assert.deepEqual(a.dominantCounts, { 'open-sea-floor': 4225 });
assert.equal(a.maxAdjacentColorDelta, 0, 'uniform open sea must not develop color steps');
assert.equal(a.maxAdjacentRoughnessDelta, 0, 'uniform open sea must not develop roughness steps');
assert.equal(a.northGuardNeighbor, 'G70');
assert.equal(a.westGuardNeighbor, 'G61');

const sourceA = buildG71Terrain3DBiomeSource();
const sourceB = buildG71Terrain3DBiomeSource();
assert.deepEqual(sourceA, sourceB, 'G71 Terrain3D biome source must be deterministic');
assert.equal(sourceA.schema, 'westeros-g71-terrain3d-biome-source-v1');
assert.equal(sourceA.width, 65);
assert.equal(sourceA.height, 65);
assert.equal(sourceA.heights.length, 4225);
assert.ok(sourceA.heights.every((value) => value === -8), 'G71 must preserve qualified open-sea depth');
assert.ok(sourceA.waterConfidence.every((value) => value === 1), 'G71 source must remain unambiguous sea');
for (const channel of ['colorR', 'colorG', 'colorB', 'roughness']) {
  assert.equal(sourceA[channel].length, 4225);
  assert.ok(sourceA[channel].every((value) => Number.isFinite(value) && value >= 0 && value <= 1));
}
assert.ok(Number.isInteger(sourceA.sourceChecksum) && sourceA.sourceChecksum >= 0);
fs.mkdirSync(PROOF_DIR, { recursive: true });
fs.writeFileSync(SOURCE_PATH, `${JSON.stringify(sourceA)}\n`, 'utf8');
console.log(`G71_TERRAIN3D_BIOME_METRICS=${JSON.stringify(a)}`);
console.log(`G71_TERRAIN3D_BIOME_SOURCE=${JSON.stringify({ samples: 4225, sourceChecksum: sourceA.sourceChecksum })}`);
console.log('NE_G71_TERRAIN3D_BIOME_SOURCE_OK');
