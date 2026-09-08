#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  TERRAIN_WIND_SNOW_SURFACE_FABRIC_POLICY,
  resolveTerrainWindSnowSurfaceFabric,
  terrainWindSnowSurfaceFabricDigest,
} from '../src/3d/world/terrainWindSnowSurfaceFabric.js';
import {
  TERRAIN_WIND_SNOW_POLICY,
  terrainWindExposureFromNeighbours,
  resolveTerrainWindSnowAdjustment,
} from '../src/3d/world/terrainWindSnowExposure.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8');
const exposureSource = read('src/3d/world/terrainWindSnowExposure.js');
const terrainSource = read('src/3d/world/terrain.js');
const biomeSource = read('src/3d/world/terrainBiomeShading.js');
const toneSource = read('src/3d/world/terrainSnowSurfaceTone.js');

assert.equal(TERRAIN_WIND_SNOW_POLICY.renderOnly, true);
assert.equal(TERRAIN_WIND_SNOW_SURFACE_FABRIC_POLICY.renderOnly, true);
assert.equal(TERRAIN_WIND_SNOW_SURFACE_FABRIC_POLICY.secondHeightAuthority, false);
assert.equal(TERRAIN_WIND_SNOW_SURFACE_FABRIC_POLICY.worldGridOverlay, false);
assert.equal(TERRAIN_WIND_SNOW_SURFACE_FABRIC_POLICY.chunkSeamSafe, true);
assert(exposureSource.includes("./terrainWindSnowSurfaceFabric.js"),
  'production exposure module must consume the shared snow surface fabric');
assert(terrainSource.includes('terrainWindExposureFromNeighbours('),
  'terrain.js must remain the runtime caller of wind/snow exposure');
assert(biomeSource.includes('resolveTerrainWindSnowAdjustment'),
  'terrain biome shading must consume the exposure adjustment helper');
assert(toneSource.includes('resolveTerrainSnowSurfaceTone'),
  'terrain snow surface tone must remain the visual snow tone owner');
assert(!exposureSource.includes('EditorMaterialStudio.js'),
  'wind/snow production must not import the editor UI');
assert(!exposureSource.includes('WorldAssetPlacementPipeline'),
  'terrain wind/snow production must not duplicate world asset placement');
assert(!exposureSource.includes('MaterialAssignmentCore'),
  'terrain wind/snow production must not fork the shared material core');

const fixtureSet = [
  { name: 'flat', args: [100, 100, 100, 100, 10] },
  { name: 'west', args: [92, 108, 100, 100, 10] },
  { name: 'east', args: [108, 92, 100, 100, 10] },
  { name: 'north-west', args: [94, 106, 94, 106, 10] },
  { name: 'south-east', args: [106, 94, 106, 94, 10] },
  { name: 'cliff-north-west', args: [76, 124, 76, 124, 10] },
  { name: 'cliff-south-east', args: [124, 76, 124, 76, 10] },
  { name: 'crosswind', args: [94, 106, 108, 92, 10] },
];

const digests = [];
for (const fixture of fixtureSet) {
  const exposure = terrainWindExposureFromNeighbours(...fixture.args);
  assert(Number.isFinite(exposure.slopeDegrees), `${fixture.name}: slope must be finite`);
  assert(Number.isFinite(exposure.aspectDot), `${fixture.name}: aspect must be finite`);
  assert(exposure.windward >= 0 && exposure.windward <= 1, `${fixture.name}: windward out of range`);
  assert(exposure.lee >= 0 && exposure.lee <= 1, `${fixture.name}: lee out of range`);
  assert(exposure.leeRetention >= 0 && exposure.leeRetention <= 1, `${fixture.name}: lee retention out of range`);
  assert(exposure.surfaceFabric, `${fixture.name}: surface fabric must be attached to runtime response`);
  const digest = terrainWindSnowSurfaceFabricDigest(exposure.surfaceFabric);
  assert(digest.length > 200, `${fixture.name}: fabric digest unexpectedly short`);
  digests.push([fixture.name, digest]);
}

const flat = terrainWindExposureFromNeighbours(100, 100, 100, 100, 10);
assert.equal(flat.windward, 0);
assert.equal(flat.lee, 0);
assert.equal(flat.surfaceFabric.foldStrength, 0);

const west = terrainWindExposureFromNeighbours(92, 108, 100, 100, 10);
const east = terrainWindExposureFromNeighbours(108, 92, 100, 100, 10);
assert(west.windward > west.lee, 'west fixture must remain windward');
assert(east.lee > east.windward, 'east fixture must remain lee');
assert(Math.abs(west.slopeDegrees - east.slopeDegrees) < 1e-9);
assert(Math.abs(west.aspectDot + east.aspectDot) < 1e-9);
assert(west.surfaceFabric.ridgeCrust > east.surfaceFabric.ridgeCrust);
assert(east.surfaceFabric.leePowder > west.surfaceFabric.leePowder);

const crosswind = terrainWindExposureFromNeighbours(94, 106, 108, 92, 10);
assert(Math.abs(crosswind.aspectDot) < 1e-9);
assert.equal(crosswind.windward, 0);
assert.equal(crosswind.lee, 0);
assert(crosswind.surfaceFabric.crosswindNeutrality > 0.95);

const highRelief = terrainWindSnowSurfaceFabric({ slopeDegrees: 46, aspectDot: 0.88, foldGradient: 0.22 });
const shelteredRelief = terrainWindSnowSurfaceFabric({ slopeDegrees: 22, aspectDot: -0.88, foldGradient: 0.22 });
assert(highRelief.ridgeCrust > shelteredRelief.ridgeCrust, 'windward ridge crust must dominate sheltered powder');
assert(shelteredRelief.leePowder > highRelief.leePowder, 'sheltered lee powder must dominate exposed ridge');
assert(highRelief.materialTemperatureBias < shelteredRelief.materialTemperatureBias, 'snow tone must cool on crust and warm in powder');

const permanentIceAdjustment = resolveTerrainWindSnowAdjustment({
  windward: highRelief.windwardAlignment,
  lee: 0,
  permanentIce: 1,
  tundra: 1,
  ridgelineExposure: highRelief.ridgeShoulder,
  shelterPocket: highRelief.shelteredPocket,
  snowMobility: highRelief.snowMobility,
  crustScour: highRelief.ridgeCrust,
  packGain: highRelief.leePowder,
});
assert(permanentIceAdjustment.windwardScour > 0);
assert.equal(permanentIceAdjustment.leeDeposit, 0);
assert(permanentIceAdjustment.windwardScour <= TERRAIN_WIND_SNOW_POLICY.northWindwardScourMax + 1e-9);

const deterministicA = resolveTerrainWindSnowSurfaceFabric({
  slopeDegrees: 31,
  aspectDot: -0.63,
  foldGradient: 0.12,
  leeRetention: 0.74,
});
const deterministicB = resolveTerrainWindSnowSurfaceFabric({
  slopeDegrees: 31,
  aspectDot: -0.63,
  foldGradient: 0.12,
  leeRetention: 0.74,
});
assert.equal(terrainWindSnowSurfaceFabricDigest(deterministicA), terrainWindSnowSurfaceFabricDigest(deterministicB));

const stressValues = [
  [-1000, -5, -2, -1],
  [-1, -1, 0, 0],
  [0, 0, 0, 0],
  [1, 1, 0.01, 1],
  [8, 0.82, 0.02, 0.2],
  [16, -0.82, 0.05, 0.4],
  [24, 0.91, 0.12, 0.8],
  [38, -0.91, 0.19, 1],
  [62, 0.5, 0.32, 0.1],
  [120, -1, 10, 10],
  [NaN, Infinity, -Infinity, NaN],
];
for (const [slope, aspect, fold, retention] of stressValues) {
  const fabric = resolveTerrainWindSnowSurfaceFabric({
    slopeDegrees: slope,
    aspectDot: aspect,
    foldGradient: fold,
    leeRetention: retention,
  });
  for (const [key, value] of Object.entries(fabric)) {
    if (key === 'materialTemperatureBias' || key === 'materialBrightnessBias') {
      assert(Number.isFinite(value), `${key} must remain finite for stress input`);
    } else {
      assert(Number.isFinite(value), `${key} must remain finite for stress input`);
      if (key === 'windwardGain' || key === 'leeGain') {
        assert(value >= TERRAIN_WIND_SNOW_SURFACE_FABRIC_POLICY.minGain - 1e-9);
        assert(value <= TERRAIN_WIND_SNOW_SURFACE_FABRIC_POLICY.maxGain + 1e-9);
      } else {
        assert(value >= 0 - 1e-9 && value <= 1 + 1e-9, `${key} must remain normalized`);
      }
    }
  }
}

const graphPatterns = [
  { source: 'terrain.js', requirement: 'terrainWindExposureFromNeighbours', required: true },
  { source: 'terrainWindSnowExposure.js', requirement: 'terrainWindSnowSurfaceFabric.js', required: true },
  { source: 'terrainBiomeShading.js', requirement: 'resolveTerrainWindSnowAdjustment', required: true },
  { source: 'terrainSnowSurfaceTone.js', requirement: 'resolveTerrainSnowSurfaceTone', required: true },
];
for (const pattern of graphPatterns) {
  const source = read(`src/3d/world/${pattern.source}`);
  assert.equal(source.includes(pattern.requirement), pattern.required, `${pattern.source}: runtime graph marker missing`);
}

const policyStrings = Object.values(TERRAIN_WIND_SNOW_SURFACE_FABRIC_POLICY).filter((value) => typeof value === 'string');
assert(policyStrings.every((value) => value.length > 0));
assert(policyStrings.some((value) => value.includes('2026-09-08')));
assert(policyStrings.some((value) => value.includes('relief')));

const uniqueDigests = new Set(digests.map(([, digest]) => digest));
assert(uniqueDigests.size >= 6, `runtime fixtures collapsed into ${uniqueDigests.size} directional surfaces`);

console.log('[checkTerrainWindSnowRuntimeParity] PASS', JSON.stringify({
  policy: TERRAIN_WIND_SNOW_SURFACE_FABRIC_POLICY.id,
  fixtureCount: fixtureSet.length,
  uniqueFixtureDigests: uniqueDigests.size,
  productionGraph: graphPatterns,
}));
