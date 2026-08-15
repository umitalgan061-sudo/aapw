#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  G60_TERRAIN3D_RELIEF_POLICY,
  buildG60Terrain3DReliefSource,
  g60ReliefGuardBounds,
  measureG60Terrain3DRelief,
  sampleG60Relief,
} from '../godot/terrain-authoring/geocells/ne/g60_relief.mjs';
import {
  G60_TERRAIN3D_BIOME_POLICY,
  g60BiomeOwnerCoordinates,
  measureG60Terrain3DBiome,
  sampleG60Biome,
} from '../godot/terrain-authoring/geocells/ne/g60_biome.mjs';
import { measureG60Hydrology } from '../godot/terrain-authoring/geocells/ne/g60_hydrology.mjs';
import { measureG61Hydrology } from '../godot/terrain-authoring/geocells/ne/g61_hydrology.mjs';
import { measureG70Terrain3DHydrology } from '../godot/terrain-authoring/geocells/ne/g70_hydrology.mjs';

const MAP_SHA = '20702972e8f45f0fbdc4da5fa68e890a82e4e822e1d58e2f369d8bc5b9c571a1';
const first = measureG60Terrain3DRelief();
const second = measureG60Terrain3DRelief();
assert.deepEqual(first, second, 'G60 Relief metrics must be deterministic');
assert.equal(first.sourceMapSha256, MAP_SHA, 'map.png provenance drifted');
assert.equal(first.geoCell, 'G60');
assert.equal(first.layer, 'Relief/Height Character');
assert.equal(first.canonicalWater, 96, 'G60 canonical water count drifted');
assert.equal(first.canonicalLand, 0, 'G60 Relief must not invent land');
assert.equal(first.canonicalSea, 96, 'G60 Relief must remain canonical sea');
assert.equal(first.canonicalLake, 0, 'G60 Relief must not invent lake semantics');
assert.equal(first.boundaryEdges, 0, 'G60 Relief must not invent coastline');
assert.equal(first.priorBiomeCanonicalSea, 96, 'merged G60 Biome provenance drifted');
assert.equal(first.samples, 65 * 65, 'G60 Relief source must stay 65x65');
assert.equal(first.nonSeaSamples, 0, 'G60 Relief guard envelope invented non-sea semantics');
assert.equal(first.biomeMismatchSamples, 0, 'G60 Relief changed merged Biome height provenance');
assert.equal(first.addedReliefAbsMax, 0, 'G60 Relief invented submarine relief absent from map.png');
assert.equal(first.heightSpan, 0, 'canonical open-sea G60 must not gain synthetic local bathymetry');
assert.equal(first.maxAdjacentHeightDelta, 0, 'G60 Relief developed a source-grid height step');
assert.equal(first.maxGuardHeightDelta, 0, 'G60 Relief guard continuity drifted');
assert.equal(first.maxGuardNormalDelta, 0, 'flat canonical seafloor guard normal changed');
assert.equal(first.maxCoordinateRoundTripError, 0, 'G60 owner-map coordinate round-trip drifted');
assert.equal(first.minHeight, G60_TERRAIN3D_BIOME_POLICY.heightMeters, 'G60 Relief left merged Biome height');
assert.equal(first.maxHeight, G60_TERRAIN3D_BIOME_POLICY.heightMeters, 'G60 Relief changed canonical seafloor height');
assert.ok(first.maxHeight <= -2.5, 'G60 Relief lifted seafloor above canonical minimum depth');
assert.ok(first.worldWidthMeters > 13000 && first.worldDepthMeters > 10000, 'physical world extent drifted');
assert.equal(G60_TERRAIN3D_RELIEF_POLICY.terrain3dImportSize, 257);
assert.equal(G60_TERRAIN3D_RELIEF_POLICY.terrain3dRegionSize, 256);
assert.equal(G60_TERRAIN3D_RELIEF_POLICY.syntheticReliefMeters, 0);

const hydrology = measureG60Hydrology();
const biome = measureG60Terrain3DBiome();
const east = measureG70Terrain3DHydrology();
const south = measureG61Hydrology();
assert.equal(hydrology.waterCells, 96, 'merged G60 Hydrology water count drifted');
assert.equal(hydrology.landCells, 0, 'merged G60 Hydrology invented land');
assert.equal(biome.canonicalSea, 96, 'merged G60 Biome canonical sea drifted');
assert.equal(biome.nonSeaSamples, 0, 'merged G60 Biome source changed semantics');
assert.equal(east.seaCells, 96, 'east G70 guard neighbor is no longer canonical sea');
assert.equal(east.landCells, 0, 'east G70 guard neighbor gained land');
assert.equal(south.seaCells, 96, 'south G61 guard neighbor is no longer canonical sea');
assert.equal(south.landCells, 0, 'south G61 guard neighbor gained land');

const sourceA = buildG60Terrain3DReliefSource();
const sourceB = buildG60Terrain3DReliefSource();
assert.deepEqual(sourceA, sourceB, 'G60 Terrain3D Relief source must be byte-deterministic');
assert.equal(sourceA.schema, 'westeros-g60-terrain3d-relief-source-v1');
assert.equal(sourceA.sourceMapSha256, MAP_SHA);
assert.equal(sourceA.policyId, G60_TERRAIN3D_RELIEF_POLICY.id);
assert.equal(sourceA.biomePolicyId, G60_TERRAIN3D_BIOME_POLICY.id);
assert.equal(sourceA.width, 65);
assert.equal(sourceA.height, 65);
assert.equal(sourceA.terrain3dImportSize, 257);
assert.equal(sourceA.terrain3dRegionSize, 256);
assert.equal(sourceA.heights.length, 65 * 65);
assert.ok(sourceA.heights.every((value) => value === sourceA.heights[0]), 'G60 Relief source invented local bathymetry');
assert.equal(sourceA.heights[0], G60_TERRAIN3D_BIOME_POLICY.heightMeters, 'source height does not match merged Biome');
assert.ok(Number.isInteger(sourceA.sourceChecksum) && sourceA.sourceChecksum >= 0, 'invalid G60 Relief source checksum');

const guard = g60ReliefGuardBounds();
const core = G60_TERRAIN3D_RELIEF_POLICY.normalizedBounds;
const lerp = (a, b, t) => a + (b - a) * t;
let denseSamples = 0;
let denseMin = Infinity;
let denseMax = -Infinity;
let maxBiomeDelta = 0;
let maxAddedRelief = 0;
let maxNormalDelta = 0;
let maxCoordinateError = 0;
let envelopeChecksum = 2166136261;
const hashEnvelopeHeight = (value) => {
  const q = Math.round((value + 128) * 1000000) | 0;
  for (const shift of [0, 8, 16, 24]) {
    envelopeChecksum = Math.imul((envelopeChecksum ^ ((q >>> shift) & 0xff)) >>> 0, 16777619) >>> 0;
  }
};

for (let y = 0; y < 129; y += 1) {
  const ny = lerp(guard.yMin, guard.yMax, y / 128);
  for (let x = 0; x < 129; x += 1) {
    const nx = lerp(guard.xMin, guard.xMax, x / 128);
    const relief = sampleG60Relief(nx, ny);
    const macro = sampleG60Biome(nx, ny);
    const owner = g60BiomeOwnerCoordinates(nx, ny, { allowGuard: true });
    assert.equal(relief.body, 'sea', `dense G60 envelope invented non-sea at ${x},${y}`);
    maxBiomeDelta = Math.max(maxBiomeDelta, Math.abs(relief.heightMeters - macro.heightMeters));
    maxAddedRelief = Math.max(maxAddedRelief, Math.abs(relief.addedReliefMeters));
    maxNormalDelta = Math.max(maxNormalDelta, Math.hypot(relief.normal.x, relief.normal.y - 1, relief.normal.z));
    maxCoordinateError = Math.max(maxCoordinateError, Math.abs(owner.normalizedX - nx), Math.abs(owner.normalizedY - ny));
    denseMin = Math.min(denseMin, relief.heightMeters);
    denseMax = Math.max(denseMax, relief.heightMeters);
    hashEnvelopeHeight(relief.heightMeters);
    denseSamples += 1;
  }
}
assert.equal(denseSamples, 129 * 129, '129x129 G60 owner/guard envelope sample count changed');
assert.equal(maxBiomeDelta, 0, '129x129 envelope left merged G60 Biome height');
assert.equal(maxAddedRelief, 0, '129x129 envelope invented submarine relief');
assert.equal(maxNormalDelta, 0, '129x129 envelope invented non-flat seafloor normals');
assert.equal(maxCoordinateError, 0, '129x129 envelope coordinate mapping drifted');
assert.equal(denseMax - denseMin, 0, '129x129 envelope gained synthetic height span');

function sourceHeight(u, v) {
  const gx = Math.max(0, Math.min(1, u)) * (sourceA.width - 1);
  const gy = Math.max(0, Math.min(1, v)) * (sourceA.height - 1);
  const x0 = Math.floor(gx);
  const y0 = Math.floor(gy);
  const x1 = Math.min(x0 + 1, sourceA.width - 1);
  const y1 = Math.min(y0 + 1, sourceA.height - 1);
  const tx = gx - x0;
  const ty = gy - y0;
  const a = sourceA.heights[y0 * sourceA.width + x0];
  const b = sourceA.heights[y0 * sourceA.width + x1];
  const c = sourceA.heights[y1 * sourceA.width + x0];
  const d = sourceA.heights[y1 * sourceA.width + x1];
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
assert.equal(importMax - importMin, 0, 'bilinear 257x257 preflight invented G60 height variation');
assert.equal(importMin, sourceA.heights[0], '257x257 preflight changed canonical G60 seafloor');

const seamAxis = [254.5, 255, 255.5, 256];
const crossAxis = [0, 32.25, 64, 96.5, 128, 160.75, 192, 224.5, 256];
let seamSamples = 0;
let maxPreflightSeamDelta = 0;
for (const boundary of seamAxis) {
  for (const cross of crossAxis) {
    const vertical = sourceHeight(boundary / 256, cross / 256);
    const horizontal = sourceHeight(cross / 256, boundary / 256);
    maxPreflightSeamDelta = Math.max(
      maxPreflightSeamDelta,
      Math.abs(vertical - sourceA.heights[0]),
      Math.abs(horizontal - sourceA.heights[0]),
    );
    seamSamples += 2;
  }
}
for (const z of seamAxis) {
  for (const x of seamAxis) {
    maxPreflightSeamDelta = Math.max(maxPreflightSeamDelta, Math.abs(sourceHeight(x / 256, z / 256) - sourceA.heights[0]));
    seamSamples += 1;
  }
}
assert.equal(maxPreflightSeamDelta, 0, 'source interpolation developed a G60 255/256 seam before Terrain3D import');

let edgeSamples = 0;
let maxOwnerEdgeDelta = 0;
for (let i = 0; i < 129; i += 1) {
  const t = i / 128;
  const ny = lerp(core.yMin, core.yMax, t);
  const nx = lerp(core.xMin, core.xMax, t);
  const westCore = sampleG60Relief(core.xMin, ny).heightMeters;
  const westGuard = sampleG60Relief(guard.xMin, ny).heightMeters;
  const eastCore = sampleG60Relief(core.xMax, ny).heightMeters;
  const eastGuard = sampleG60Relief(guard.xMax, ny).heightMeters;
  const southCore = sampleG60Relief(nx, core.yMax).heightMeters;
  const southGuard = sampleG60Relief(nx, guard.yMax).heightMeters;
  maxOwnerEdgeDelta = Math.max(
    maxOwnerEdgeDelta,
    Math.abs(westCore - westGuard),
    Math.abs(eastCore - eastGuard),
    Math.abs(southCore - southGuard),
  );
  edgeSamples += 3;
}
assert.equal(maxOwnerEdgeDelta, 0, 'G60 owner-map guard developed relief discontinuity');

const envelope = Object.freeze({
  denseSamples,
  denseHeightSpan: Number((denseMax - denseMin).toFixed(8)),
  maxBiomeDelta,
  maxAddedRelief,
  maxNormalDelta,
  maxCoordinateError,
  denseChecksum: envelopeChecksum >>> 0,
  importSamples,
  importHeightSpan: Number((importMax - importMin).toFixed(8)),
  importChecksum: importChecksum >>> 0,
  seamSamples,
  maxPreflightSeamDelta,
  edgeSamples,
  maxOwnerEdgeDelta,
  eastNeighbor: Object.freeze({ seaCells: east.seaCells, landCells: east.landCells }),
  southNeighbor: Object.freeze({ seaCells: south.seaCells, landCells: south.landCells }),
});

const emitArg = process.argv.find((arg) => arg.startsWith('--emit-source='));
if (emitArg) {
  const output = path.resolve(emitArg.slice('--emit-source='.length));
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify(sourceA)}\n`, 'utf8');
}
console.log(`NE_G60_RELIEF_METRICS=${JSON.stringify(first)}`);
console.log(`NE_G60_RELIEF_SOURCE=${JSON.stringify({ samples: sourceA.heights.length, heightMeters: sourceA.heights[0], sourceChecksum: sourceA.sourceChecksum })}`);
console.log(`NE_G60_RELIEF_PHYSICAL_ENVELOPE=${JSON.stringify(envelope)}`);
console.log('NE_G60_RELIEF_VALIDATION_OK');
