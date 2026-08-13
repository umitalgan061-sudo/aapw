#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  G70_TERRAIN3D_HYDROLOGY_POLICY,
  buildG70Terrain3DHydrologySource,
  measureG70Terrain3DHydrology,
} from '../godot/terrain-authoring/geocells/ne/g70_hydrology.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PROOF_DIR = path.join(ROOT, 'godot/terrain-authoring/.terrain3d-proof');
const SOURCE_PATH = path.join(PROOF_DIR, 'g70-hydrology-source.json');
const EXPECTED_MAP_SHA = '20702972e8f45f0fbdc4da5fa68e890a82e4e822e1d58e2f369d8bc5b9c571a1';

assert.equal(G70_TERRAIN3D_HYDROLOGY_POLICY.geoCell, 'G70');
assert.equal(G70_TERRAIN3D_HYDROLOGY_POLICY.layer, 'Coast/Hydrology');
assert.equal(G70_TERRAIN3D_HYDROLOGY_POLICY.sourceMapSha256, EXPECTED_MAP_SHA);
assert.deepEqual(G70_TERRAIN3D_HYDROLOGY_POLICY.pixelBounds, { xMin: 1344, xMax: 1536, yMin: 0, yMax: 128 });
assert.deepEqual(G70_TERRAIN3D_HYDROLOGY_POLICY.maskCellBounds, { xMin: 84, xMax: 96, yMin: 0, yMax: 8 });
assert.equal(G70_TERRAIN3D_HYDROLOGY_POLICY.terrain3dImportSize, 257);
assert.equal(G70_TERRAIN3D_HYDROLOGY_POLICY.terrain3dRegionSize, 256);

const first = measureG70Terrain3DHydrology();
const second = measureG70Terrain3DHydrology();
assert.deepEqual(first, second, 'G70 hydrology metrics must be deterministic');
assert.equal(first.baseCells, 96, 'G70 must cover exactly 12x8 canonical mask cells');
assert.equal(first.waterCells, 96, 'G70 canonical water count drifted');
assert.equal(first.landCells, 0, 'G70 must not invent canonical land');
assert.equal(first.seaCells, 96, 'G70 must remain canonical sea');
assert.equal(first.lakeCells, 0, 'G70 must not invent a lake');
assert.equal(first.boundaryEdges, 0, 'G70 must not invent an internal coastline');
assert.equal(first.semanticChecksum, 848461253, 'G70 canonical sea fingerprint drifted');
assert.equal(first.guardSamples, 21, 'G70 must measure west/south neighbour guard semantics');
assert.equal(first.guardSeaSamples, 21, 'G70 guard band must remain sea across G60/G71');
assert.equal(first.guardNonSeaSamples, 0, 'G70 guard band developed invented land/lake');
assert.equal(first.denseNonSeaSamples, 0, 'dense guard-backed G70 source must remain sea');
assert.ok(first.maxHeightMeters <= -G70_TERRAIN3D_HYDROLOGY_POLICY.minimumWaterDepthMeters, 'G70 seafloor must stay below the water plane');
assert.ok(first.minHeightMeters >= -G70_TERRAIN3D_HYDROLOGY_POLICY.openWaterDepthMeters - 1e-9, 'G70 seafloor exceeded canonical open-water depth');
assert.ok(first.maxAdjacentHeightDeltaMeters <= 1e-9, 'uniform open-sea hydrology developed a visible height step');
assert.ok(first.maxGuardHeightDeltaMeters <= 1e-9, 'G70/G60/G71 seafloor guard continuity drifted');

const sourceA = buildG70Terrain3DHydrologySource();
const sourceB = buildG70Terrain3DHydrologySource();
assert.deepEqual(sourceA, sourceB, 'G70 Terrain3D source must be byte-deterministic before serialization');
assert.equal(sourceA.schema, 'westeros-g70-terrain3d-hydrology-source-v1');
assert.equal(sourceA.sourceMapSha256, EXPECTED_MAP_SHA);
assert.equal(sourceA.width, 65);
assert.equal(sourceA.height, 65);
assert.equal(sourceA.heights.length, 65 * 65);
assert.equal(sourceA.waterConfidence.length, 65 * 65);
assert.ok(sourceA.heights.every((value) => Number.isFinite(value) && value <= -2.5), 'G70 source contains a non-finite or non-submerged height');
assert.ok(sourceA.waterConfidence.every((value) => value === 1), 'G70 source guard domain must remain unambiguously open sea');
assert.equal(sourceA.sourceChecksum, first.sourceChecksum, 'source checksum must match measured guard-backed field');

fs.mkdirSync(PROOF_DIR, { recursive: true });
fs.writeFileSync(SOURCE_PATH, `${JSON.stringify(sourceA)}\n`, 'utf8');
console.log(`G70_TERRAIN3D_HYDROLOGY_METRICS=${JSON.stringify(first)}`);
console.log(`G70_TERRAIN3D_HYDROLOGY_SOURCE=${JSON.stringify({ samples: sourceA.heights.length, sourceChecksum: sourceA.sourceChecksum, minHeightMeters: Math.min(...sourceA.heights), maxHeightMeters: Math.max(...sourceA.heights) })}`);
console.log('NE_G70_TERRAIN3D_HYDROLOGY_SOURCE_OK');
