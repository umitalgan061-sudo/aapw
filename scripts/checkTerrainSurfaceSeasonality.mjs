#!/usr/bin/env node
import assert from 'node:assert/strict';
import { resolveTerrainSeasonalState, resolveTerrainSeasonalMaterialResponse, TERRAIN_SEASONAL_POLICY } from '../src/3d/world/terrainSurfaceSeasonality.js';

assert.equal(TERRAIN_SEASONAL_POLICY.renderOnly, true);
assert.equal(TERRAIN_SEASONAL_POLICY.deterministic, true);
assert.equal(TERRAIN_SEASONAL_POLICY.canonicalHeightUnchanged, true);
assert.equal(TERRAIN_SEASONAL_POLICY.canonicalHydrologyUnchanged, true);
assert.equal(TERRAIN_SEASONAL_POLICY.canonicalColliderUnchanged, true);
const phases = [0, 0.08, 0.12, 0.22, 0.38, 0.58, 0.70, 0.78, 0.88, 0.94, 1];
const snapshots = phases.map((phase) => resolveTerrainSeasonalState({ worldX: -920, worldZ: 1440, heightMeters: 180, slopeDegrees: 9, moisture: 0.62, seasonPhase: phase }));
assert.deepEqual(snapshots[0], snapshots.at(-1));
for (const [index, state] of snapshots.entries()) {
  for (const key of ['phase','regional','broad','micro','localClimate','wet','dry','litter','cold','frost','wetFilm','droughtCrust','autumnLitter','freezeDry','seasonalContrast']) assert(state[key] >= 0 && state[key] <= 1, `${index}:${key} out of bounds`);
  const response = resolveTerrainSeasonalMaterialResponse({ state, baseColor: { r: 0.33, g: 0.41, b: 0.24 }, baseRoughness: 0.87 });
  assert(response.roughness >= 0 && response.roughness <= 1);
  assert(response.normalStrength >= 0 && response.normalStrength <= TERRAIN_SEASONAL_POLICY.maxNormalEnergy + 0.001);
}
const same = resolveTerrainSeasonalState({ worldX: 611, worldZ: -203, heightMeters: 72, slopeDegrees: 7, moisture: 0.41, seasonPhase: 0.58 });
const repeat = resolveTerrainSeasonalState({ worldX: 611, worldZ: -203, heightMeters: 72, slopeDegrees: 7, moisture: 0.41, seasonPhase: 0.58 });
assert.deepEqual(same, repeat);
assert(snapshots[2].wet > snapshots[5].wet, 'spring wet phase should exceed summer wet response');
assert(snapshots[7].litter > snapshots[2].litter, 'autumn phase should increase litter response');
assert(snapshots[9].cold > snapshots[5].cold, 'winter should increase cold response');
console.log(JSON.stringify({ policyId: TERRAIN_SEASONAL_POLICY.id, phases: phases.length, pass: true }));
