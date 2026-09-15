#!/usr/bin/env node
import assert from 'node:assert/strict';
import { resolveTerrainSoilStructure, resolveTerrainSoilStructureMaterialResponse, TERRAIN_SOIL_STRUCTURE_POLICY } from '../src/3d/world/terrainSurfaceSoilStructure.js';

const colors = [
  { r: 0.24, g: 0.35, b: 0.16 }, { r: 0.32, g: 0.41, b: 0.22 },
  { r: 0.42, g: 0.39, b: 0.28 }, { r: 0.48, g: 0.46, b: 0.39 },
];
for (let i = 0; i < 24; i += 1) {
  const x = (i - 12) * 413.75;
  const z = (i * 271.5) - 2900;
  const heightMeters = -2 + ((i * 37) % 525);
  const slopeDegrees = 2 + ((i * 9) % 36);
  const moisture = ((i * 17) % 101) / 100;
  const baseColor = colors[i % colors.length];
  const first = resolveTerrainSoilStructure({ worldX: x, worldZ: z, heightMeters, slopeDegrees, moisture, baseColor });
  const second = resolveTerrainSoilStructure({ worldX: x, worldZ: z, heightMeters, slopeDegrees, moisture, baseColor });
  assert.deepEqual(first, second, `soil state ${i} must be deterministic`);
  for (const key of ['broad','regional','aggregate','pore','crackField','crackFine','compaction','mineral','lowland','slopeMask','wetness','organic','aggregateBreakup','poreNetwork','crackRim','compacted','friability','mineralSurface','soilSkin']) assert(first[key] >= 0 && first[key] <= 1, `${key} out of bounds`);
  const response = resolveTerrainSoilStructureMaterialResponse({ state: first, baseColor, baseRoughness: 0.87 });
  for (const channel of Object.values(response.color)) assert(channel >= 0 && channel <= 1);
  assert(response.roughness >= 0 && response.roughness <= 1);
  assert(response.normalStrength >= 0 && response.normalStrength <= TERRAIN_SOIL_STRUCTURE_POLICY.maxNormalStrength + 0.001);
}
const wet = resolveTerrainSoilStructure({ worldX: 810, worldZ: -470, heightMeters: 72, slopeDegrees: 8, moisture: 0.9, baseColor: colors[1] });
const dry = resolveTerrainSoilStructure({ worldX: 810, worldZ: -470, heightMeters: 72, slopeDegrees: 8, moisture: 0.1, baseColor: colors[1] });
assert(wet.poreNetwork >= 0 && wet.poreNetwork <= 1);
assert(dry.crackRim >= 0 && dry.crackRim <= 1);
assert(TERRAIN_SOIL_STRUCTURE_POLICY.maxRoughnessShift <= 0.12);
console.log(JSON.stringify({ policyId: TERRAIN_SOIL_STRUCTURE_POLICY.id, samples: 24, pass: true }));
