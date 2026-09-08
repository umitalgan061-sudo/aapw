#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  TERRAIN_WIND_SNOW_SURFACE_FABRIC_POLICY as FABRIC,
  resolveTerrainWindSnowSurfaceFabric,
  terrainWindSnowSurfaceFabricDigest,
} from '../src/3d/world/terrainWindSnowSurfaceFabric.js';
import {
  TERRAIN_WIND_SNOW_POLICY as WIND,
  terrainWindExposureFromNeighbours,
  resolveTerrainWindSnowAdjustment,
} from '../src/3d/world/terrainWindSnowExposure.js';

const root = new URL('..', import.meta.url);
const read = (p) => fs.readFileSync(new URL(p, root), 'utf8');
const assertFinite = (object, label) => {
  for (const [key, value] of Object.entries(object)) if (typeof value === 'number') assert(Number.isFinite(value), `${label}.${key} non-finite`);
};

const terrain = read('src/3d/world/terrain.js');
const biome = read('src/3d/world/terrainBiomeShading.js');
const exposure = read('src/3d/world/terrainWindSnowExposure.js');
const tone = read('src/3d/world/terrainSnowSurfaceTone.js');

assert.equal(FABRIC.renderOnly, true);
assert.equal(FABRIC.heightAuthorityUnchanged, true);
assert.equal(FABRIC.hydrologyAuthorityUnchanged, true);
assert.equal(FABRIC.colliderAuthorityUnchanged, true);
assert.equal(FABRIC.placementAuthorityUnchanged, true);
assert.equal(FABRIC.chunkSeamSafe, true);
assert.equal(FABRIC.secondHeightAuthority, false);
assert.equal(FABRIC.worldGridOverlay, false);
assert(terrain.includes('terrainWindExposureFromNeighbours'), 'terrain runtime no longer calls exposure');
assert(exposure.includes('terrainWindSnowSurfaceFabric.js'), 'exposure is not wired to the shared fabric');
assert(biome.includes('resolveTerrainWindSnowAdjustment'), 'biome coverage lost wind/snow adjustment');
assert(biome.includes('resolveTerrainSnowSurfaceTone'), 'biome color lost snow-tone classifier');
assert(tone.includes('packedWindwardGain') && tone.includes('leePowderPaletteGain'), 'snow tone family controls missing');
assert(!exposure.includes('EditorMaterialStudio.js'));
assert(!exposure.includes('MaterialAssignmentCore.js'));
assert(!exposure.includes('WorldAssetPlacementPipeline.js'));

const fixtures = [
  ['flat', [100,100,100,100,10]],
  ['west', [92,108,100,100,10]],
  ['east', [108,92,100,100,10]],
  ['northwest', [94,106,94,106,10]],
  ['southeast', [106,94,106,94,10]],
  ['crosswind', [94,106,108,92,10]],
  ['cliff-lee', [124,76,124,76,10]],
];
const outputs = new Map();
for (const [name, args] of fixtures) {
  const result = terrainWindExposureFromNeighbours(...args);
  outputs.set(name, result);
  assertFinite(result, name);
  assert(result.windward >= 0 && result.windward <= 1);
  assert(result.lee >= 0 && result.lee <= 1);
  assert(result.surfaceFabric && typeof result.surfaceFabric === 'object');
  assert(Number.isFinite(result.surfaceFabric.windwardGain));
  assert(Number.isFinite(result.surfaceFabric.leeGain));
}
assert(outputs.get('west').windward > outputs.get('west').lee);
assert(outputs.get('east').lee > outputs.get('east').windward);
assert.equal(outputs.get('crosswind').windward, 0);
assert.equal(outputs.get('crosswind').lee, 0);
assert(outputs.get('northwest').windward > outputs.get('west').windward);
assert(outputs.get('southeast').lee > outputs.get('east').lee);
assert.equal(outputs.get('cliff-lee').lee, 0);

const fabricA = resolveTerrainWindSnowSurfaceFabric({ slopeDegrees: 31, aspectDot: -0.63, foldGradient: 0.12, leeRetention: 0.74 });
const fabricB = resolveTerrainWindSnowSurfaceFabric({ slopeDegrees: 31, aspectDot: -0.63, foldGradient: 0.12, leeRetention: 0.74 });
assert.equal(terrainWindSnowSurfaceFabricDigest(fabricA), terrainWindSnowSurfaceFabricDigest(fabricB));
assert(fabricA.leePowder > fabricA.ridgeCrust);
assert(fabricA.continuity >= 0 && fabricA.continuity <= 1);

const adjustment = resolveTerrainWindSnowAdjustment({
  windward: outputs.get('northwest').windward,
  lee: outputs.get('southeast').lee,
  permanentIce: 1,
  tundra: 1,
  ridgelineExposure: outputs.get('northwest').surfaceFabric.ridgeShoulder,
  shelterPocket: outputs.get('southeast').surfaceFabric.shelteredPocket,
  snowMobility: outputs.get('northwest').surfaceFabric.slope,
  crustScour: outputs.get('northwest').surfaceFabric.ridgeCrust,
  packGain: outputs.get('southeast').surfaceFabric.leePowder,
});
assertFinite(adjustment, 'adjustment');
assert(adjustment.windwardScour >= 0 && adjustment.windwardScour <= WIND.northWindwardScourMax + 1e-9);
assert(adjustment.leeDeposit >= 0 && adjustment.leeDeposit <= WIND.northLeeDepositMax + 1e-9);

console.log('[checkTerrainWindSnowRuntimeParity] PASS', JSON.stringify({
  policy: FABRIC.id,
  fixtureCount: fixtures.length,
  digests: [...outputs.entries()].map(([name, result]) => [name, terrainWindSnowSurfaceFabricDigest(result.surfaceFabric)]),
  permanentIceAdjustment: adjustment,
}));
