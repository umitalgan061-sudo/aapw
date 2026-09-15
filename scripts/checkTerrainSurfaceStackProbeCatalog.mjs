#!/usr/bin/env node
import assert from 'node:assert/strict';
import { TERRAIN_SURFACE_STACK_PROBES_A } from './fixtures/terrainSurfaceStackProbesA.js';
import { TERRAIN_SURFACE_STACK_PROBES_B } from './fixtures/terrainSurfaceStackProbesB.js';
import { resolveTerrainSedimentState } from '../src/3d/world/terrainSurfaceSediment.js';
import { resolveTerrainBiogenicState } from '../src/3d/world/terrainSurfaceBiogenic.js';
import { resolveTerrainRunoffPathState } from '../src/3d/world/terrainSurfaceRunoffPaths.js';
import { resolveTerrainSoilStructure } from '../src/3d/world/terrainSurfaceSoilStructure.js';
import { resolveTerrainSeasonalState } from '../src/3d/world/terrainSurfaceSeasonality.js';

const groups = [
  ['A', TERRAIN_SURFACE_STACK_PROBES_A],
  ['B', TERRAIN_SURFACE_STACK_PROBES_B],
];
const ids = new Set();
let samples = 0;
let checksum = 0;
for (const [groupName, probes] of groups) {
  assert.equal(probes.length, 400, `${groupName} must contain 400 probes`);
  for (const [id, worldX, worldZ, heightMeters, slopeDegrees, moisture] of probes) {
    assert(!ids.has(id), `duplicate probe id ${id}`);
    ids.add(id);
    assert(Number.isFinite(worldX) && Number.isFinite(worldZ));
    assert(Number.isFinite(heightMeters) && Number.isFinite(slopeDegrees) && Number.isFinite(moisture));
    assert(slopeDegrees >= 0 && slopeDegrees <= 55);
    assert(moisture >= 0 && moisture <= 1);
    const sedimentA = resolveTerrainSedimentState({ worldX, worldZ, heightMeters, slopeDegrees });
    const sedimentB = resolveTerrainSedimentState({ worldX, worldZ, heightMeters, slopeDegrees });
    assert.deepEqual(sedimentA, sedimentB, `${id} sediment determinism`);
    const baseColor = { r: 0.31, g: 0.39, b: 0.22 };
    const bioA = resolveTerrainBiogenicState({ worldX, worldZ, heightMeters, slopeDegrees, moisture, baseColor });
    const bioB = resolveTerrainBiogenicState({ worldX, worldZ, heightMeters, slopeDegrees, moisture, baseColor });
    assert.deepEqual(bioA, bioB, `${id} biogenic determinism`);
    const runoffA = resolveTerrainRunoffPathState({ worldX, worldZ, heightMeters, slopeDegrees, moisture });
    const runoffB = resolveTerrainRunoffPathState({ worldX, worldZ, heightMeters, slopeDegrees, moisture });
    assert.deepEqual(runoffA, runoffB, `${id} runoff determinism`);
    const soilA = resolveTerrainSoilStructure({ worldX, worldZ, heightMeters, slopeDegrees, moisture, baseColor });
    const soilB = resolveTerrainSoilStructure({ worldX, worldZ, heightMeters, slopeDegrees, moisture, baseColor });
    assert.deepEqual(soilA, soilB, `${id} soil determinism`);
    const seasonalA = resolveTerrainSeasonalState({ worldX, worldZ, heightMeters, slopeDegrees, moisture, seasonPhase: 0.34 });
    const seasonalB = resolveTerrainSeasonalState({ worldX, worldZ, heightMeters, slopeDegrees, moisture, seasonPhase: 0.34 });
    assert.deepEqual(seasonalA, seasonalB, `${id} seasonal determinism`);
    for (const value of [sedimentA.sedimentLoad, sedimentA.wash, sedimentA.film, sedimentA.crust, bioA.litter, bioA.humus, bioA.moss, runoffA.runoff, runoffA.washStreak, soilA.aggregateBreakup, soilA.poreNetwork, soilA.crackRim, seasonalA.wet, seasonalA.dry, seasonalA.litter, seasonalA.cold]) {
      assert(value >= 0 && value <= 1, `${id} bounded scalar=${value}`);
      checksum += value;
    }
    samples += 1;
  }
}
assert.equal(samples, 800);
assert.equal(ids.size, 800);
assert(Number.isFinite(checksum));
console.log(JSON.stringify({ samples, uniqueProbeIds: ids.size, checksum: Number(checksum.toFixed(8)), pass: true }));
