#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  G70_TERRAIN3D_BIOME_POLICY,
  buildG70Terrain3DBiomeSource,
  measureG70Terrain3DBiome,
} from '../godot/terrain-authoring/geocells/ne/g70_biome.mjs';
import { measureG70Terrain3DHydrology } from '../godot/terrain-authoring/geocells/ne/g70_hydrology.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PROOF_DIR = path.join(ROOT, 'godot/terrain-authoring/.terrain3d-proof');
const SOURCE_PATH = path.join(PROOF_DIR, 'g70-biome-source.json');
const EXPECTED_MAP_SHA = '20702972e8f45f0fbdc4da5fa68e890a82e4e822e1d58e2f369d8bc5b9c571a1';

assert.equal(G70_TERRAIN3D_BIOME_POLICY.geoCell, 'G70');
assert.equal(G70_TERRAIN3D_BIOME_POLICY.layer, 'Macro Albedo/Biome');
assert.equal(G70_TERRAIN3D_BIOME_POLICY.sourceMapSha256, EXPECTED_MAP_SHA);
assert.equal(G70_TERRAIN3D_BIOME_POLICY.sourceGridSize, 65);
assert.equal(G70_TERRAIN3D_BIOME_POLICY.terrain3dImportSize, 257);
assert.equal(G70_TERRAIN3D_BIOME_POLICY.terrain3dRegionSize, 256);

const hydrology = measureG70Terrain3DHydrology();
assert.equal(hydrology.waterCells, 96, 'merged G70 hydrology water count drifted');
assert.equal(hydrology.landCells, 0, 'merged G70 hydrology invented land');
assert.equal(hydrology.seaCells, 96, 'merged G70 hydrology must remain canonical sea');
assert.equal(hydrology.boundaryEdges, 0, 'merged G70 hydrology developed an internal coastline');
assert.equal(hydrology.guardSeaSamples, hydrology.guardSamples, 'merged G70 west/south guards must remain sea');

const first = measureG70Terrain3DBiome();
const second = measureG70Terrain3DBiome();
assert.deepEqual(first, second, 'G70 Macro Albedo/Biome metrics must be deterministic');
assert.equal(first.canonicalWater, 96, 'G70 biome canonical water count drifted');
assert.equal(first.canonicalLand, 0, 'G70 biome must not invent canonical land');
assert.equal(first.canonicalSea, 96, 'G70 biome must remain canonical sea');
assert.equal(first.canonicalLake, 0, 'G70 biome must not invent a lake');
assert.equal(first.boundaryEdges, 0, 'G70 biome must not invent an internal coastline');
assert.equal(first.samples, 65 * 65, 'G70 biome must retain a 65x65 deterministic source field');
assert.equal(first.denseNonSeaSamples, 0, 'G70 biome guard-backed source must remain sea');
assert.deepEqual(first.dominantCounts, { 'open-sea-floor': 65 * 65 }, 'G70 must not introduce a land biome into canonical open sea');
assert.ok(first.minRoughness >= 0 && first.maxRoughness <= 1, 'G70 roughness left the physical unit interval');
assert.ok(first.maxAdjacentColorDelta <= 0.03, 'G70 macro albedo developed a visible adjacent color step');
assert.ok(first.maxAdjacentRoughnessDelta <= 0.03, 'G70 macro roughness developed a visible adjacent step');
assert.ok(first.maxGuardColorDelta <= 0.04, 'G70/G60/G71 macro albedo guard continuity drifted');
assert.ok(first.maxGuardRoughnessDelta <= 0.04, 'G70/G60/G71 roughness guard continuity drifted');

const sourceA = buildG70Terrain3DBiomeSource();
const sourceB = buildG70Terrain3DBiomeSource();
assert.deepEqual(sourceA, sourceB, 'G70 Terrain3D biome source must be byte-deterministic before serialization');
assert.equal(sourceA.schema, 'westeros-g70-terrain3d-biome-source-v1');
assert.equal(sourceA.sourceMapSha256, EXPECTED_MAP_SHA);
assert.equal(sourceA.width, 65);
assert.equal(sourceA.height, 65);
assert.equal(sourceA.sourceGridSize, 65);
assert.equal(sourceA.terrain3dImportSize, 257);
assert.equal(sourceA.terrain3dRegionSize, 256);
for (const channel of ['heights', 'waterConfidence', 'colorR', 'colorG', 'colorB', 'roughness']) {
  assert.equal(sourceA[channel].length, 65 * 65, `G70 biome channel ${channel} size drifted`);
}
assert.ok(sourceA.heights.every((value) => Number.isFinite(value) && value <= -2.5), 'G70 biome source changed the merged submerged height contract');
assert.ok(sourceA.waterConfidence.every((value) => value === 1), 'G70 biome source guard domain must remain unambiguously open sea');
for (const channel of ['colorR', 'colorG', 'colorB', 'roughness']) {
  assert.ok(sourceA[channel].every((value) => Number.isFinite(value) && value >= 0 && value <= 1), `G70 biome channel ${channel} left the unit interval`);
}
assert.ok(Number.isInteger(sourceA.sourceChecksum) && sourceA.sourceChecksum >= 0, 'G70 biome source checksum is invalid');

fs.mkdirSync(PROOF_DIR, { recursive: true });
fs.writeFileSync(SOURCE_PATH, `${JSON.stringify(sourceA)}\n`, 'utf8');
console.log(`G70_TERRAIN3D_BIOME_METRICS=${JSON.stringify(first)}`);
console.log(`G70_TERRAIN3D_BIOME_SOURCE=${JSON.stringify({ samples: sourceA.heights.length, sourceChecksum: sourceA.sourceChecksum, colorChecksum: first.colorChecksum, roughnessChecksum: first.roughnessChecksum, minRoughness: first.minRoughness, maxRoughness: first.maxRoughness })}`);
console.log('NE_G70_TERRAIN3D_BIOME_SOURCE_OK');
