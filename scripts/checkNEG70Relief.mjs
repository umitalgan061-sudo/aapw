#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  G70_TERRAIN3D_RELIEF_POLICY,
  buildG70Terrain3DReliefSource,
  measureG70Terrain3DRelief,
} from '../godot/terrain-authoring/geocells/ne/g70_relief.mjs';
import { measureG70Terrain3DHydrology } from '../godot/terrain-authoring/geocells/ne/g70_hydrology.mjs';
import { measureG70Terrain3DBiome } from '../godot/terrain-authoring/geocells/ne/g70_biome.mjs';

const MAP_SHA = '20702972e8f45f0fbdc4da5fa68e890a82e4e822e1d58e2f369d8bc5b9c571a1';
const first = measureG70Terrain3DRelief();
const second = measureG70Terrain3DRelief();
assert.deepEqual(first, second, 'G70 relief metrics must be deterministic');
assert.equal(first.sourceMapSha256, MAP_SHA, 'map.png provenance drifted');
assert.equal(first.geoCell, 'G70');
assert.equal(first.layer, 'Relief/Height Character');
assert.equal(first.canonicalWater, 96, 'G70 canonical water count drifted');
assert.equal(first.canonicalLand, 0, 'G70 Relief must not invent land');
assert.equal(first.canonicalSea, 96, 'G70 Relief must remain canonical sea');
assert.equal(first.boundaryEdges, 0, 'G70 Relief must not invent coastline');
assert.equal(first.priorBiomeCanonicalSea, 96, 'merged G70 Biome provenance drifted');
assert.equal(first.samples, 65 * 65, 'G70 relief source must stay 65x65');
assert.equal(first.nonSeaSamples, 0, 'G70 relief guard domain invented non-sea semantics');
assert.equal(first.hydrologyMismatchSamples, 0, 'G70 Relief changed merged Hydrology height');
assert.equal(first.biomeMismatchSamples, 0, 'G70 Relief changed merged Biome height provenance');
assert.equal(first.addedReliefAbsMax, 0, 'G70 Relief invented submarine relief absent from map.png');
assert.equal(first.heightSpan, 0, 'canonical open-sea G70 must not gain synthetic local bathymetry');
assert.equal(first.maxAdjacentHeightDelta, 0, 'G70 Relief developed a source-grid height step');
assert.equal(first.maxGuardHeightDelta, 0, 'G70/G60/G71 relief guard continuity drifted');
assert.equal(first.maxGuardNormalDelta, 0, 'flat canonical seafloor guard normal changed');
assert.ok(first.maxHeight <= -2.5 && first.minHeight <= -2.5, 'G70 Relief lifted seafloor above canonical minimum depth');
assert.ok(first.worldWidthMeters > 13000 && first.worldDepthMeters > 10000, 'physical world extent drifted');
assert.equal(G70_TERRAIN3D_RELIEF_POLICY.terrain3dImportSize, 257);
assert.equal(G70_TERRAIN3D_RELIEF_POLICY.terrain3dRegionSize, 256);

const hydrology = measureG70Terrain3DHydrology();
const biome = measureG70Terrain3DBiome();
assert.equal(first.minHeight, Number(hydrology.minHeightMeters.toFixed(8)), 'Relief min height left merged Hydrology');
assert.equal(first.maxHeight, Number(hydrology.maxHeightMeters.toFixed(8)), 'Relief max height left merged Hydrology');
assert.equal(biome.denseNonSeaSamples, 0, 'merged Biome guard domain changed');

const sourceA = buildG70Terrain3DReliefSource();
const sourceB = buildG70Terrain3DReliefSource();
assert.deepEqual(sourceA, sourceB, 'G70 Terrain3D relief source must be byte-deterministic');
assert.equal(sourceA.schema, 'westeros-g70-terrain3d-relief-source-v1');
assert.equal(sourceA.sourceMapSha256, MAP_SHA);
assert.equal(sourceA.width, 65);
assert.equal(sourceA.height, 65);
assert.equal(sourceA.terrain3dImportSize, 257);
assert.equal(sourceA.terrain3dRegionSize, 256);
assert.equal(sourceA.heights.length, 65 * 65);
assert.ok(sourceA.heights.every((value) => value === sourceA.heights[0]), 'G70 source invented local bathymetry');
assert.equal(sourceA.heights[0], first.minHeight, 'source height does not match measured canonical seafloor');
assert.ok(Number.isInteger(sourceA.sourceChecksum) && sourceA.sourceChecksum >= 0, 'invalid relief source checksum');

const emitArg = process.argv.find((arg) => arg.startsWith('--emit-source='));
if (emitArg) {
  const output = path.resolve(emitArg.slice('--emit-source='.length));
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify(sourceA)}\n`, 'utf8');
}

console.log(`NE_G70_RELIEF_METRICS=${JSON.stringify(first)}`);
console.log(`NE_G70_RELIEF_SOURCE=${JSON.stringify({ samples: sourceA.heights.length, heightMeters: sourceA.heights[0], sourceChecksum: sourceA.sourceChecksum })}`);
console.log('NE_G70_RELIEF_VALIDATION_OK');
