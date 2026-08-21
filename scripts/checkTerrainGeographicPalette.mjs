#!/usr/bin/env node
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { WORLD_SCALE } from '../src/3d/config.js';
import { WORLD_REFERENCE_ALIGNMENT } from '../src/3d/world/worldReferenceAlignment.js';
import {
  TERRAIN_BIOME_PALETTE,
  TERRAIN_BIOME_SHADING_POLICY,
  coastalCryosphereWeightAtWorldZ,
  northClimateWeightsAtWorldZ,
  resolveTerrainBiomeColor,
  resolveTerrainSnowCoverage,
  terrainConcavityMetersFromNeighbours,
} from '../src/3d/world/terrainBiomeShading.js';

function worldZForNormalizedMapY(normalizedY) {
  const centerMapY = (WORLD_SCALE.MAP_BOUNDS.minY + WORLD_SCALE.MAP_BOUNDS.maxY) * 0.5;
  const mapY = normalizedY * WORLD_REFERENCE_ALIGNMENT.mapCanvasHeightUnits;
  return (mapY - centerMapY) * WORLD_SCALE.METERS_PER_MAP_UNIT;
}

function colorAt({ normalizedY = 0.60, height = 12, slope = 3, rockWeight = 0, snowWeight = 0, worldX = 750 } = {}) {
  return resolveTerrainBiomeColor(new THREE.Color(), {
    heightAboveSeaMeters: height,
    slopeDegrees: slope,
    rockWeight,
    snowWeight,
    worldX,
    worldZ: worldZForNormalizedMapY(normalizedY),
  });
}

function snowAt({ normalizedY, height, slope, snowWeight = 0, terrainConcavityMeters = 0 }) {
  return resolveTerrainSnowCoverage({
    heightAboveSeaMeters: height,
    slopeDegrees: slope,
    snowWeight,
    worldZ: worldZForNormalizedMapY(normalizedY),
    terrainConcavityMeters,
  });
}

function coastalCryosphereAt(normalizedY) {
  return coastalCryosphereWeightAtWorldZ(worldZForNormalizedMapY(normalizedY));
}

function distance(a, b) {
  return Math.hypot(a.r - b.r, a.g - b.g, a.b - b.b);
}

function luminance(color) {
  return 0.2126 * color.r + 0.7152 * color.g + 0.0722 * color.b;
}

const lowland = colorAt({ normalizedY: 0.62, height: 18, slope: 4, worldX: 120 });
const meadowVariant = colorAt({ normalizedY: 0.62, height: 18, slope: 4, worldX: 2100 });
const shore = colorAt({ normalizedY: 0.62, height: 0.5, slope: 2, worldX: 120 });
const southCoastalLowland = colorAt({ normalizedY: 0.62, height: 2.0, slope: 2, worldX: 120 });
const southSeabed = colorAt({ normalizedY: 0.62, height: -1.8, slope: 2, worldX: 120 });
const upland = colorAt({ normalizedY: 0.62, height: 150, slope: 8, worldX: 120 });
const cliff = colorAt({ normalizedY: 0.62, height: 150, slope: 52, rockWeight: 0.9, worldX: 120 });
const tundra = colorAt({ normalizedY: 0.33, height: 18, slope: 4, worldX: 120 });
const tundraShore = colorAt({ normalizedY: 0.33, height: 0.5, slope: 2, worldX: 120 });
const tundraCoastalLowland = colorAt({ normalizedY: 0.33, height: 2.0, slope: 2, worldX: 120 });
const tundraSeabed = colorAt({ normalizedY: 0.33, height: -1.8, slope: 2, worldX: 120 });
const iceTransitionShore = colorAt({ normalizedY: 0.22, height: 0.5, slope: 2, worldX: 120 });
const farNorth = colorAt({ normalizedY: 0.06, height: 18, slope: 4, worldX: 120 });
const farNorthShore = colorAt({ normalizedY: 0.06, height: 0.5, slope: 2, worldX: 120 });
const farNorthCoastalLowland = colorAt({ normalizedY: 0.06, height: 2.0, slope: 2, worldX: 120 });
const farNorthSeabed = colorAt({ normalizedY: 0.06, height: -1.8, slope: 2, worldX: 120 });
const highSnow = colorAt({ normalizedY: 0.62, height: 560, slope: 8, snowWeight: 0.8, worldX: 120 });

assert(distance(lowland, meadowVariant) > 0.01,
  'lowlands must retain geographic variation instead of collapsing to one flat green');
assert(distance(lowland, shore) > 0.08,
  'southern shoreline must visually separate from inland grass');
assert(distance(lowland, upland) > 0.05,
  'upland heath/dry ground must separate from lowland vegetation');
assert(distance(upland, cliff) > 0.05,
  'steep rock authority must visibly override dry upland');
assert(distance(lowland, tundra) > 0.08,
  'northern tundra transition must be visually distinct from temperate lowland');
assert(distance(tundra, farNorth) > 0.08,
  'permanent cryosphere must remain visibly distinct from tundra');
assert(luminance(farNorth) > luminance(lowland),
  'low-altitude permanent north must read as bright snow/ice rather than green ground');
assert(distance(farNorth, TERRAIN_BIOME_PALETTE.SNOW) < distance(farNorth, TERRAIN_BIOME_PALETTE.GRASS_LOW),
  'permanent north must be perceptually closer to snow than grass');
assert(distance(highSnow, TERRAIN_BIOME_PALETTE.SNOW) < distance(highSnow, TERRAIN_BIOME_PALETTE.DRY_UPLAND),
  'high canonical/altitude snow must remain snow even outside the far north');

assert(distance(shore, TERRAIN_BIOME_PALETTE.SHORE_SAND) < distance(shore, TERRAIN_BIOME_PALETTE.FROZEN_SHORE),
  'temperate shoreline should remain perceptually closer to warm sand than frozen shore');
assert(distance(tundraShore, TERRAIN_BIOME_PALETTE.FROZEN_SHORE) < distance(tundraShore, TERRAIN_BIOME_PALETTE.SHORE_SAND),
  'tundra shoreline should prefer frozen shore over warm sand');
assert(distance(iceTransitionShore, TERRAIN_BIOME_PALETTE.GLACIAL_SHORE) < distance(iceTransitionShore, TERRAIN_BIOME_PALETTE.SHORE_SAND),
  'ice-transition shoreline should prefer glacial/frozen tones over warm sand');
assert(distance(farNorthShore, TERRAIN_BIOME_PALETTE.GLACIAL_SHORE) < distance(farNorthShore, TERRAIN_BIOME_PALETTE.SHORE_SAND),
  'permanent-ice shoreline should read glacial rather than sandy');
assert(distance(farNorthCoastalLowland, TERRAIN_BIOME_PALETTE.COASTAL_ICE)
    < distance(farNorthCoastalLowland, TERRAIN_BIOME_PALETTE.SHORE_SAND),
  'far-north low coastal land should continue the cryosphere instead of reverting to beach sand');
assert(distance(tundraCoastalLowland, TERRAIN_BIOME_PALETTE.COASTAL_ICE)
    < distance(southCoastalLowland, TERRAIN_BIOME_PALETTE.COASTAL_ICE),
  'tundra low coast should begin frosting before the permanent-ice boundary');
assert(distance(southSeabed, farNorthSeabed) > 0.03,
  'submerged northern shallows should not share the same warm/green seabed tint as temperate coasts');
assert(distance(farNorthSeabed, TERRAIN_BIOME_PALETTE.NORTH_SEABED) < distance(southSeabed, TERRAIN_BIOME_PALETTE.NORTH_SEABED),
  'far-north seabed should move toward the cold northern seabed palette');
assert(distance(tundraSeabed, southSeabed) > 0.01,
  'tundra shallows should begin cooling before the permanent-ice boundary');

// Coastal cryosphere must ramp continuously from a restrained tundra frost apron into permanent ice.
// The helper is used by the production palette path, so this contract catches climate-boundary seams
// without depending on RGB mottle or unrelated lowland vegetation variation.
const tundraCoastalCryosphere = coastalCryosphereAt(0.33);
const transitionCoastalCryosphere = coastalCryosphereAt(0.22);
const farNorthCoastalCryosphere = coastalCryosphereAt(0.06);
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

let previousCoastalCryosphere = coastalCryosphereAt(0.06);
let maxSouthwardStrengthening = 0;
for (let normalizedY = 0.07; normalizedY <= 0.40; normalizedY += 0.01) {
  const current = coastalCryosphereAt(normalizedY);
  maxSouthwardStrengthening = Math.max(maxSouthwardStrengthening, current - previousCoastalCryosphere);
  assert(current <= previousCoastalCryosphere + 0.015,
    `coastal cryosphere must not strengthen abruptly southward near normalizedY=${normalizedY.toFixed(2)}`);
  assert(Math.abs(current - previousCoastalCryosphere) < 0.075,
    `coastal cryosphere transition must remain continuous near normalizedY=${normalizedY.toFixed(2)}`);
  previousCoastalCryosphere = current;
}

// Snow accumulation must remain geographic rather than a flat latitude wash. Gentle tundra slopes
// can hold a restrained drift supplement, while steeper faces expose more rock and shed that drift.
const tundraGentleSnow = snowAt({ normalizedY: 0.33, height: 80, slope: 4 });
const tundraSteepSnow = snowAt({ normalizedY: 0.33, height: 80, slope: 32 });
assert(tundraGentleSnow.driftSupply > tundraSteepSnow.driftSupply,
  'gentle tundra slopes should receive more bounded drift supply than steep faces');
assert(tundraGentleSnow.snowSupply > tundraSteepSnow.snowSupply,
  'tundra snow supply should respond to terrain slope instead of latitude alone');
assert(tundraGentleSnow.driftSupply <= TERRAIN_BIOME_SHADING_POLICY.tundraSnowDriftGain + 1e-9,
  'tundra drift supplement must remain within the authored bounded gain');

const northGentleSnow = snowAt({ normalizedY: 0.06, height: 40, slope: 4 });
const northSteepSnow = snowAt({ normalizedY: 0.06, height: 40, slope: 52 });
assert(northGentleSnow.snowAmount >= northSteepSnow.snowAmount,
  'flat permanent-ice terrain should retain at least as much snow as a steep exposed face');
assert(northSteepSnow.moraineExposure >= 0,
  'steep permanent-ice terrain must expose a finite non-negative moraine contribution');

// Four-neighbour terrain form must distinguish deposition bowls from exposed ridges without changing
// canonical height authority. A local bowl has neighbours above its centre; a ridge has them below.
assert.equal(terrainConcavityMetersFromNeighbours(100, 106, 104, 105, 105), 5,
  'terrain-form helper must report positive concavity for a bowl/valley');
assert.equal(terrainConcavityMetersFromNeighbours(100, 96, 95, 94, 95), -5,
  'terrain-form helper must report negative concavity for a convex ridge');
const tundraBowlSnow = snowAt({ normalizedY: 0.33, height: 120, slope: 7, terrainConcavityMeters: 5 });
const tundraNeutralSnow = snowAt({ normalizedY: 0.33, height: 120, slope: 7, terrainConcavityMeters: 0 });
const tundraRidgeSnow = snowAt({ normalizedY: 0.33, height: 120, slope: 7, terrainConcavityMeters: -5 });
assert(tundraBowlSnow.snowAmount > tundraNeutralSnow.snowAmount,
  'tundra bowls should retain more snow than locally neutral terrain');
assert(tundraNeutralSnow.snowAmount > tundraRidgeSnow.snowAmount,
  'convex tundra ridges should be visibly more wind-scoured than neutral terrain');
assert(tundraBowlSnow.terrainFormSupply <= TERRAIN_BIOME_SHADING_POLICY.tundraConcavitySnowGain + 1e-9,
  'concavity accumulation must stay within its bounded tundra gain');
assert(tundraRidgeSnow.ridgeScour <= TERRAIN_BIOME_SHADING_POLICY.tundraRidgeScourMax + 1e-9,
  'ridge scour must stay within its bounded tundra ceiling');

let previousColdPreference = null;
for (let normalizedY = 0.06; normalizedY <= 0.40; normalizedY += 0.01) {
  const sample = colorAt({ normalizedY, height: 0.5, slope: 2, worldX: 120 });
  const coldPreference = distance(sample, TERRAIN_BIOME_PALETTE.SHORE_SAND)
    - distance(sample, TERRAIN_BIOME_PALETTE.FROZEN_SHORE);
  if (previousColdPreference !== null) {
    assert(Math.abs(coldPreference - previousColdPreference) < 0.15,
      `shore climate transition must remain visually continuous near normalizedY=${normalizedY.toFixed(2)}`);
  }
  previousColdPreference = coldPreference;
}

const northClimate = northClimateWeightsAtWorldZ(worldZForNormalizedMapY(0.06));
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
  highSnow: highSnow.getHexString(),
}));
