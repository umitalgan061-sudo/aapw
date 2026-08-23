#!/usr/bin/env node
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { WORLD_SCALE } from '../src/3d/config.js';
import { normalizedReferenceToWorldXZ } from '../src/3d/world/worldReferenceAlignment.js';
import {
  TERRAIN_BIOME_PALETTE,
  TERRAIN_BIOME_SHADING_POLICY,
  coastalCryosphereWeightAtWorldXZ,
  northClimateWeightsAtWorldXZ,
  resolveTerrainBiomeColor,
  resolveTerrainSnowCoverage,
  terrainConcavityMetersFromNeighbours,
} from '../src/3d/world/terrainBiomeShading.js';

function worldAt(normalizedX, normalizedY) {
  return normalizedReferenceToWorldXZ(
    normalizedX,
    normalizedY,
    WORLD_SCALE.MAP_BOUNDS,
    WORLD_SCALE.METERS_PER_MAP_UNIT,
  );
}

function colorAt({ normalizedX = 0.175, normalizedY = 0.60, height = 12, slope = 3, rockWeight = 0, snowWeight = 0 } = {}) {
  const world = worldAt(normalizedX, normalizedY);
  return resolveTerrainBiomeColor(new THREE.Color(), {
    heightAboveSeaMeters: height,
    slopeDegrees: slope,
    rockWeight,
    snowWeight,
    worldX: world.x,
    worldZ: world.z,
  });
}

function snowAt({ normalizedX = 0.175, normalizedY, height, slope, snowWeight = 0, terrainConcavityMeters = 0 }) {
  const world = worldAt(normalizedX, normalizedY);
  return resolveTerrainSnowCoverage({
    heightAboveSeaMeters: height,
    slopeDegrees: slope,
    snowWeight,
    worldX: world.x,
    worldZ: world.z,
    terrainConcavityMeters,
  });
}

function coastalCryosphereAt(normalizedY, normalizedX = 0.145) {
  const world = worldAt(normalizedX, normalizedY);
  return coastalCryosphereWeightAtWorldXZ(world.x, world.z);
}

function distance(a, b) {
  return Math.hypot(a.r - b.r, a.g - b.g, a.b - b.b);
}

function luminance(color) {
  return 0.2126 * color.r + 0.7152 * color.g + 0.0722 * color.b;
}

const lowland = colorAt({ normalizedX: 0.52, normalizedY: 0.62, height: 18, slope: 4 });
const meadowVariant = colorAt({ normalizedX: 0.72, normalizedY: 0.62, height: 18, slope: 4 });
const shore = colorAt({ normalizedX: 0.52, normalizedY: 0.62, height: 0.5, slope: 2 });
const southCoastalLowland = colorAt({ normalizedX: 0.52, normalizedY: 0.62, height: 2.0, slope: 2 });
const southSeabed = colorAt({ normalizedX: 0.52, normalizedY: 0.62, height: -1.8, slope: 2 });
const upland = colorAt({ normalizedX: 0.52, normalizedY: 0.62, height: 150, slope: 8 });
const cliff = colorAt({ normalizedX: 0.52, normalizedY: 0.62, height: 150, slope: 52, rockWeight: 0.9 });
const tundra = colorAt({ normalizedX: 0.175, normalizedY: 0.285, height: 18, slope: 4 });
const tundraShore = colorAt({ normalizedX: 0.175, normalizedY: 0.285, height: 0.5, slope: 2 });
const tundraCoastalLowland = colorAt({ normalizedX: 0.175, normalizedY: 0.285, height: 2.0, slope: 2 });
const tundraSeabed = colorAt({ normalizedX: 0.175, normalizedY: 0.285, height: -1.8, slope: 2 });
const iceTransitionShore = colorAt({ normalizedX: 0.155, normalizedY: 0.20, height: 0.5, slope: 2 });
const farNorth = colorAt({ normalizedX: 0.145, normalizedY: 0.115, height: 18, slope: 4 });
const farNorthShore = colorAt({ normalizedX: 0.145, normalizedY: 0.115, height: 0.5, slope: 2 });
const farNorthCoastalLowland = colorAt({ normalizedX: 0.145, normalizedY: 0.115, height: 2.0, slope: 2 });
const farNorthSeabed = colorAt({ normalizedX: 0.145, normalizedY: 0.115, height: -1.8, slope: 2 });
const sameLatitudeEast = colorAt({ normalizedX: 0.72, normalizedY: 0.115, height: 18, slope: 4 });
const highSnow = colorAt({ normalizedX: 0.52, normalizedY: 0.62, height: 560, slope: 8, snowWeight: 0.8 });

assert(distance(lowland, meadowVariant) > 0.01,
  'lowlands must retain geographic variation instead of collapsing to one flat green');
assert(distance(lowland, shore) > 0.08,
  'southern shoreline must visually separate from inland grass');
assert(distance(lowland, upland) > 0.05,
  'upland heath/dry ground must separate from lowland vegetation');
assert(distance(upland, cliff) > 0.05,
  'steep rock authority must visibly override dry upland');
assert(distance(lowland, tundra) > 0.08,
  'canonical North tundra must be visually distinct from temperate lowland');
assert(distance(tundra, farNorth) > 0.08,
  'permanent cryosphere must remain visibly distinct from tundra');
assert(luminance(farNorth) > luminance(lowland),
  'low-altitude permanent north must read as bright snow/ice rather than green ground');
assert(distance(farNorth, TERRAIN_BIOME_PALETTE.SNOW) < distance(farNorth, TERRAIN_BIOME_PALETTE.GRASS_LOW),
  'permanent north must be perceptually closer to snow than grass');
assert(distance(sameLatitudeEast, TERRAIN_BIOME_PALETTE.SNOW) > distance(sameLatitudeEast, TERRAIN_BIOME_PALETTE.GRASS_LOW),
  'same-latitude east must remain temperate outside the Westeros cryosphere');
assert(distance(highSnow, TERRAIN_BIOME_PALETTE.SNOW) < distance(highSnow, TERRAIN_BIOME_PALETTE.DRY_UPLAND),
  'high canonical/altitude snow must remain snow outside the far north');

assert(distance(shore, TERRAIN_BIOME_PALETTE.SHORE_SAND) < distance(shore, TERRAIN_BIOME_PALETTE.FROZEN_SHORE),
  'temperate shoreline should remain perceptually closer to warm sand than frozen shore');
const tundraCryospherePaletteDistance = Math.min(
  distance(tundraShore, TERRAIN_BIOME_PALETTE.FROZEN_SHORE),
  distance(tundraShore, TERRAIN_BIOME_PALETTE.GLACIAL_SHORE),
  distance(tundraShore, TERRAIN_BIOME_PALETTE.COASTAL_ICE),
  distance(tundraShore, TERRAIN_BIOME_PALETTE.SNOW),
);
assert(tundraCryospherePaletteDistance < distance(tundraShore, TERRAIN_BIOME_PALETTE.SHORE_SAND),
  'tundra shoreline should stay perceptually inside the frozen/glacial palette family instead of warm sand');
assert(distance(iceTransitionShore, TERRAIN_BIOME_PALETTE.GLACIAL_SHORE) < distance(iceTransitionShore, TERRAIN_BIOME_PALETTE.SHORE_SAND),
  'ice-transition shoreline should prefer glacial/frozen tones over warm sand');
assert(distance(farNorthShore, TERRAIN_BIOME_PALETTE.GLACIAL_SHORE) < distance(farNorthShore, TERRAIN_BIOME_PALETTE.SHORE_SAND),
  'permanent-ice shoreline should read glacial rather than sandy');
assert(distance(farNorthCoastalLowland, TERRAIN_BIOME_PALETTE.COASTAL_ICE)
    < distance(farNorthCoastalLowland, TERRAIN_BIOME_PALETTE.SHORE_SAND),
  'far-north low coastal land should continue the cryosphere instead of reverting to beach sand');
assert(distance(tundraCoastalLowland, TERRAIN_BIOME_PALETTE.COASTAL_ICE)
    < distance(southCoastalLowland, TERRAIN_BIOME_PALETTE.COASTAL_ICE),
  'tundra low coast should begin frosting before permanent ice');
assert(distance(southSeabed, farNorthSeabed) > 0.03,
  'submerged northern shallows should not share the same warm/green seabed tint as temperate coasts');
assert(distance(farNorthSeabed, TERRAIN_BIOME_PALETTE.NORTH_SEABED) < distance(southSeabed, TERRAIN_BIOME_PALETTE.NORTH_SEABED),
  'far-north seabed should move toward the cold northern seabed palette');
assert(distance(tundraSeabed, southSeabed) > 0.01,
  'tundra shallows should begin cooling before permanent ice');

const tundraCoastalCryosphere = coastalCryosphereAt(0.285, 0.175);
const transitionCoastalCryosphere = coastalCryosphereAt(0.20, 0.155);
const farNorthCoastalCryosphere = coastalCryosphereAt(0.115, 0.145);
assert(tundraCoastalCryosphere > 0,
  'tundra coastline must retain a non-zero frost apron before permanent ice begins');
assert(transitionCoastalCryosphere > tundraCoastalCryosphere,
  'coastal cryosphere should strengthen moving north through the ice transition');
assert(farNorthCoastalCryosphere > transitionCoastalCryosphere,
  'permanent-ice coast should own the strongest coastal cryosphere signal');
assert(farNorthCoastalCryosphere <= TERRAIN_BIOME_SHADING_POLICY.northCoastalIceStrength + 1e-9,
  'permanent coastal apron must remain within the authored strength ceiling');
assert(tundraCoastalCryosphere <= TERRAIN_BIOME_SHADING_POLICY.northCoastalIceTundraStrength + 1e-9,
  'tundra frost apron must remain subordinate to permanent coastal ice');

let previousCoastalCryosphere = coastalCryosphereAt(0.115);
let maxSouthwardStrengthening = 0;
for (let normalizedY = 0.125; normalizedY <= 0.34; normalizedY += 0.01) {
  const current = coastalCryosphereAt(normalizedY);
  maxSouthwardStrengthening = Math.max(maxSouthwardStrengthening, current - previousCoastalCryosphere);
  assert(current <= previousCoastalCryosphere + 0.02,
    `coastal cryosphere must not strengthen abruptly southward near normalizedY=${normalizedY.toFixed(3)}`);
  assert(Math.abs(current - previousCoastalCryosphere) < 0.08,
    `coastal cryosphere transition must remain continuous near normalizedY=${normalizedY.toFixed(3)}`);
  previousCoastalCryosphere = current;
}

const tundraGentleSnow = snowAt({ normalizedX: 0.175, normalizedY: 0.285, height: 80, slope: 4 });
const tundraSteepSnow = snowAt({ normalizedX: 0.175, normalizedY: 0.285, height: 80, slope: 32 });
assert(tundraGentleSnow.driftSupply > tundraSteepSnow.driftSupply,
  'gentle tundra slopes should receive more bounded drift supply than steep faces');
assert(tundraGentleSnow.snowSupply > tundraSteepSnow.snowSupply,
  'tundra snow supply should respond to terrain slope instead of latitude alone');
assert(tundraGentleSnow.driftSupply <= TERRAIN_BIOME_SHADING_POLICY.tundraSnowDriftGain + 1e-9,
  'tundra drift supplement must remain within the authored bounded gain');

const northGentleSnow = snowAt({ normalizedX: 0.145, normalizedY: 0.115, height: 40, slope: 4 });
const northSteepSnow = snowAt({ normalizedX: 0.145, normalizedY: 0.115, height: 40, slope: 52 });
assert(northGentleSnow.snowAmount >= northSteepSnow.snowAmount,
  'flat permanent-ice terrain should retain at least as much snow as a steep exposed face');
assert(northSteepSnow.moraineExposure >= 0,
  'steep permanent-ice terrain must expose a finite non-negative moraine contribution');

assert.equal(terrainConcavityMetersFromNeighbours(100, 106, 104, 105, 105), 5,
  'terrain-form helper must report positive concavity for a bowl/valley');
assert.equal(terrainConcavityMetersFromNeighbours(100, 96, 95, 94, 95), -5,
  'terrain-form helper must report negative concavity for a convex ridge');
const tundraBowlSnow = snowAt({ normalizedX: 0.175, normalizedY: 0.285, height: 120, slope: 7, terrainConcavityMeters: 5 });
const tundraNeutralSnow = snowAt({ normalizedX: 0.175, normalizedY: 0.285, height: 120, slope: 7, terrainConcavityMeters: 0 });
const tundraRidgeSnow = snowAt({ normalizedX: 0.175, normalizedY: 0.285, height: 120, slope: 7, terrainConcavityMeters: -5 });
assert(tundraBowlSnow.snowAmount > tundraNeutralSnow.snowAmount,
  'tundra bowls should retain more snow than locally neutral terrain');
assert(tundraNeutralSnow.snowAmount > tundraRidgeSnow.snowAmount,
  'convex tundra ridges should be visibly more wind-scoured than neutral terrain');
assert(tundraBowlSnow.terrainFormSupply <= TERRAIN_BIOME_SHADING_POLICY.tundraConcavitySnowGain + 1e-9,
  'concavity accumulation must stay within its bounded tundra gain');
assert(tundraRidgeSnow.ridgeScour <= TERRAIN_BIOME_SHADING_POLICY.tundraRidgeScourMax + 1e-9,
  'ridge scour must stay within its bounded tundra ceiling');

let previousColdPreference = null;
for (let normalizedY = 0.11; normalizedY <= 0.34; normalizedY += 0.01) {
  const sample = colorAt({ normalizedX: 0.145, normalizedY, height: 0.5, slope: 2 });
  const coldPreference = distance(sample, TERRAIN_BIOME_PALETTE.SHORE_SAND)
    - distance(sample, TERRAIN_BIOME_PALETTE.FROZEN_SHORE);
  if (previousColdPreference !== null) {
    assert(Math.abs(coldPreference - previousColdPreference) < 0.15,
      `shore climate transition must remain visually continuous near normalizedY=${normalizedY.toFixed(2)}`);
  }
  previousColdPreference = coldPreference;
}

const northWorld = worldAt(0.145, 0.115);
const northClimate = northClimateWeightsAtWorldXZ(northWorld.x, northWorld.z);
assert(northClimate.permanentIce > 0.95, 'far-north palette fixture must sit inside permanent ice');
assert.equal(TERRAIN_BIOME_SHADING_POLICY.heightAuthorityUnchanged, true,
  'geographic palette must remain render-only and never become terrain height authority');

for (const [label, color] of Object.entries({
  lowland,
  meadowVariant,
  shore,
  southCoastalLowland,
  southSeabed,
  upland,
  cliff,
  tundra,
  tundraShore,
  tundraCoastalLowland,
  tundraSeabed,
  iceTransitionShore,
  farNorth,
  farNorthShore,
  farNorthCoastalLowland,
  farNorthSeabed,
  sameLatitudeEast,
  highSnow,
})) {
  assert(Number.isFinite(color.r) && Number.isFinite(color.g) && Number.isFinite(color.b), `${label} color must be finite`);
  assert(color.r >= 0 && color.r <= 1 && color.g >= 0 && color.g <= 1 && color.b >= 0 && color.b <= 1,
    `${label} color must remain inside displayable linear RGB bounds`);
}

console.log('[checkTerrainGeographicPalette] PASS', JSON.stringify({
  policy: TERRAIN_BIOME_SHADING_POLICY.id,
  northPermanentIce: northClimate.permanentIce,
  tundraCoastalCryosphere,
  transitionCoastalCryosphere,
  farNorthCoastalCryosphere,
  maxSouthwardStrengthening,
  tundraGentleDrift: tundraGentleSnow.driftSupply,
  tundraSteepDrift: tundraSteepSnow.driftSupply,
  tundraBowlSnow: tundraBowlSnow.snowAmount,
  tundraNeutralSnow: tundraNeutralSnow.snowAmount,
  tundraRidgeSnow: tundraRidgeSnow.snowAmount,
  lowland: lowland.getHexString(),
  shore: shore.getHexString(),
  southCoastalLowland: southCoastalLowland.getHexString(),
  southSeabed: southSeabed.getHexString(),
  upland: upland.getHexString(),
  cliff: cliff.getHexString(),
  tundra: tundra.getHexString(),
  tundraShore: tundraShore.getHexString(),
  tundraCoastalLowland: tundraCoastalLowland.getHexString(),
  iceTransitionShore: iceTransitionShore.getHexString(),
  farNorth: farNorth.getHexString(),
  farNorthShore: farNorthShore.getHexString(),
  farNorthCoastalLowland: farNorthCoastalLowland.getHexString(),
  farNorthSeabed: farNorthSeabed.getHexString(),
  sameLatitudeEast: sameLatitudeEast.getHexString(),
  highSnow: highSnow.getHexString(),
}));