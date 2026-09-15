#!/usr/bin/env node
import assert from 'node:assert/strict';
import { resolveTerrainRunoffPathState, resolveTerrainRunoffMaterialResponse, TERRAIN_RUNOFF_PATH_POLICY } from '../src/3d/world/terrainSurfaceRunoffPaths.js';

const samples = [
  [0, 0, 32, 2, 0.3], [420, -180, 48, 6, 0.5], [-760, 640, 92, 12, 0.7],
  [1140, 880, 150, 20, 0.8], [-1420, -920, 230, 29, 0.6], [2100, 1440, 360, 38, 0.4],
  [3199.998, -2710.002, 72, 18, 0.55], [-3200.002, 2710.002, 118, 31, 0.72],
];
assert.equal(TERRAIN_RUNOFF_PATH_POLICY.renderOnly, true);
assert.equal(TERRAIN_RUNOFF_PATH_POLICY.deterministic, true);
assert.equal(TERRAIN_RUNOFF_PATH_POLICY.canonicalHydrologyUnchanged, true);
assert.equal(TERRAIN_RUNOFF_PATH_POLICY.canonicalHeightUnchanged, true);
for (const [x, z, h, slope, moisture] of samples) {
  const a = resolveTerrainRunoffPathState({ worldX: x, worldZ: z, heightMeters: h, slopeDegrees: slope, moisture });
  const b = resolveTerrainRunoffPathState({ worldX: x, worldZ: z, heightMeters: h, slopeDegrees: slope, moisture });
  assert.deepEqual(a, b);
  for (const key of ['broad','path','branch','stain','dryLane','slopeEnergy','strong','lowland','moistureEnergy','runoff','washStreak','branchStreak','drying','shoulderBleach','fineFilm','sedimentCarry','exposedAggregate']) assert(a[key] >= 0 && a[key] <= 1, `${key} out of range`);
  const response = resolveTerrainRunoffMaterialResponse({ state: a, baseColor: { r: 0.34, g: 0.41, b: 0.25 }, baseRoughness: 0.87 });
  assert(response.roughness >= 0 && response.roughness <= 1);
  assert(response.normalStrength >= 0 && response.normalStrength <= TERRAIN_RUNOFF_PATH_POLICY.maximumNormalEnergy + 0.001);
}
const flat = resolveTerrainRunoffPathState({ worldX: 400, worldZ: 200, heightMeters: 82, slopeDegrees: 3, moisture: 0.66 });
const steep = resolveTerrainRunoffPathState({ worldX: 400, worldZ: 200, heightMeters: 82, slopeDegrees: 34, moisture: 0.66 });
assert(steep.runoff >= flat.runoff);
assert(steep.washStreak >= flat.washStreak);
console.log(JSON.stringify({ policyId: TERRAIN_RUNOFF_PATH_POLICY.id, samples: samples.length, pass: true }));
