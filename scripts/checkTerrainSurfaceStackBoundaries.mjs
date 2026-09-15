#!/usr/bin/env node
import assert from 'node:assert/strict';
import { resolveTerrainSedimentState } from '../src/3d/world/terrainSurfaceSediment.js';
import { resolveTerrainBiogenicState } from '../src/3d/world/terrainSurfaceBiogenic.js';
import { resolveTerrainRunoffPathState } from '../src/3d/world/terrainSurfaceRunoffPaths.js';
import { resolveTerrainSoilStructure } from '../src/3d/world/terrainSurfaceSoilStructure.js';
import { resolveTerrainSeasonalState } from '../src/3d/world/terrainSurfaceSeasonality.js';

const points = [
  [-9600, -5400], [-4800, -2700], [0, 0], [4800, 2700], [9600, 5400],
  [-0.002, 499.998], [499.998, -0.002], [500.002, 0.002], [-500.002, -0.002],
  [3199.75, -2710.25], [-4210.125, 2380.875], [7810.5, -610.25],
];

const baseColor = { r: 0.31, g: 0.39, b: 0.22 };
const allSystems = [];
for (const [x, z] of points) {
  const sediment = resolveTerrainSedimentState({ worldX: x, worldZ: z, heightMeters: 72, slopeDegrees: 8 });
  const biogenic = resolveTerrainBiogenicState({ worldX: x, worldZ: z, heightMeters: 72, slopeDegrees: 8, moisture: 0.58, baseColor });
  const runoff = resolveTerrainRunoffPathState({ worldX: x, worldZ: z, heightMeters: 72, slopeDegrees: 8, moisture: 0.58 });
  const soil = resolveTerrainSoilStructure({ worldX: x, worldZ: z, heightMeters: 72, slopeDegrees: 8, moisture: 0.58, baseColor });
  const seasonal = resolveTerrainSeasonalState({ worldX: x, worldZ: z, heightMeters: 72, slopeDegrees: 8, moisture: 0.58, seasonPhase: 0.34 });
  const states = { sediment, biogenic, runoff, soil, seasonal };
  allSystems.push(states);
  for (const [name, state] of Object.entries(states)) {
    for (const [key, value] of Object.entries(state)) {
      if (typeof value === 'number') assert(Number.isFinite(value), `${name}.${key} must be finite`);
    }
  }
  assert(Math.abs(sediment.sedimentLoad - resolveTerrainSedimentState({ worldX: x, worldZ: z, heightMeters: 72, slopeDegrees: 8 }).sedimentLoad) < 1e-12);
  assert(Math.abs(runoff.runoff - resolveTerrainRunoffPathState({ worldX: x, worldZ: z, heightMeters: 72, slopeDegrees: 8, moisture: 0.58 }).runoff) < 1e-12);
  assert(Math.abs(soil.compacted - resolveTerrainSoilStructure({ worldX: x, worldZ: z, heightMeters: 72, slopeDegrees: 8, moisture: 0.58, baseColor }).compacted) < 1e-12);
}

function bounded(value, label) { assert(value >= -1e-9 && value <= 1 + 1e-9, `${label}=${value}`); }
for (const systems of allSystems) {
  for (const value of [systems.sediment.basin, systems.sediment.wash, systems.sediment.film, systems.sediment.crust]) bounded(value, 'sediment');
  for (const value of [systems.biogenic.litter, systems.biogenic.humus, systems.biogenic.moss, systems.biogenic.dryCrust]) bounded(value, 'biogenic');
  for (const value of [systems.runoff.runoff, systems.runoff.washStreak, systems.runoff.fineFilm, systems.runoff.exposedAggregate]) bounded(value, 'runoff');
  for (const value of [systems.soil.aggregateBreakup, systems.soil.poreNetwork, systems.soil.crackRim, systems.soil.compacted]) bounded(value, 'soil');
  for (const value of [systems.seasonal.wet, systems.seasonal.dry, systems.seasonal.litter, systems.seasonal.cold]) bounded(value, 'seasonal');
}

const seasonalPhases = [0, 0.12, 0.30, 0.58, 0.78, 0.94, 1];
const phaseSnapshots = seasonalPhases.map((phase) => resolveTerrainSeasonalState({ worldX: 1280, worldZ: -880, heightMeters: 180, slopeDegrees: 7, moisture: 0.62, seasonPhase: phase }));
assert.deepEqual(phaseSnapshots[0], phaseSnapshots.at(-1), 'season phase wrap must be continuous');
assert(phaseSnapshots[1].wet >= phaseSnapshots[3].wet, 'wet-season response should exceed dry peak');
assert(phaseSnapshots[4].litter >= phaseSnapshots[1].litter, 'autumn transition must retain litter response');
assert(phaseSnapshots[5].cold >= phaseSnapshots[3].cold, 'winter response must exceed summer cold response');

const moistureLow = resolveTerrainBiogenicState({ worldX: 170, worldZ: 240, heightMeters: 82, slopeDegrees: 8, moisture: 0.10, baseColor });
const moistureHigh = resolveTerrainBiogenicState({ worldX: 170, worldZ: 240, heightMeters: 82, slopeDegrees: 8, moisture: 0.90, baseColor });
assert(moistureHigh.humus >= moistureLow.humus);
assert(moistureHigh.moss >= moistureLow.moss);

const slopeLow = resolveTerrainRunoffPathState({ worldX: 170, worldZ: 240, heightMeters: 82, slopeDegrees: 3, moisture: 0.62 });
const slopeHigh = resolveTerrainRunoffPathState({ worldX: 170, worldZ: 240, heightMeters: 82, slopeDegrees: 31, moisture: 0.62 });
assert(slopeHigh.runoff >= slopeLow.runoff);
assert(slopeHigh.exposedAggregate >= slopeLow.exposedAggregate - 0.02);

const flatSoil = resolveTerrainSoilStructure({ worldX: 170, worldZ: 240, heightMeters: 82, slopeDegrees: 3, moisture: 0.62, baseColor });
const steepSoil = resolveTerrainSoilStructure({ worldX: 170, worldZ: 240, heightMeters: 82, slopeDegrees: 31, moisture: 0.62, baseColor });
assert(flatSoil.soilSkin >= steepSoil.soilSkin - 0.08);
assert(steepSoil.crackRim >= flatSoil.crackRim - 0.12);

const lowSediment = resolveTerrainSedimentState({ worldX: 920, worldZ: -410, heightMeters: 24, slopeDegrees: 2 });
const highSediment = resolveTerrainSedimentState({ worldX: 920, worldZ: -410, heightMeters: 480, slopeDegrees: 2 });
assert(highSediment.dryCrust >= lowSediment.dryCrust);

console.log(JSON.stringify({ points: points.length, seasonalPhases: seasonalPhases.length, pass: true }));
