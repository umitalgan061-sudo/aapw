import assert from 'node:assert/strict';
import * as THREE from 'three';
import { WORLD_SCALE } from '../src/3d/config.js';
import { normalizedReferenceToWorldXZ } from '../src/3d/world/worldReferenceAlignment.js';
import {
  TERRAIN_BIOME_PALETTE,
  TERRAIN_BIOME_SHADING_POLICY,
  coastalCryosphereProfileAtWorldXZ,
  mountainSnowlineAtWorldXZ,
  northClimateWeightsAtWorldXZ,
  resolveTerrainBiomeColor,
  resolveTerrainSnowCoverage,
} from '../src/3d/world/terrainBiomeShading.js';

const worldAt = (x, y) => normalizedReferenceToWorldXZ(
  x,
  y,
  WORLD_SCALE.MAP_BOUNDS,
  WORLD_SCALE.METERS_PER_MAP_UNIT,
);
const distance = (a, b) => Math.hypot(a.r - b.r, a.g - b.g, a.b - b.b);
const colourAt = (world, heightAboveSeaMeters = 4) => resolveTerrainBiomeColor(new THREE.Color(), {
  heightAboveSeaMeters,
  slopeDegrees: 2,
  worldX: world.x,
  worldZ: world.z,
});
const snowAt = (world, heightAboveSeaMeters = 12) => resolveTerrainSnowCoverage({
  heightAboveSeaMeters,
  slopeDegrees: 4,
  worldX: world.x,
  worldZ: world.z,
});

assert.equal(TERRAIN_BIOME_SHADING_POLICY.renderOnly, true);
assert.equal(TERRAIN_BIOME_SHADING_POLICY.heightAuthorityUnchanged, true);
assert.equal(TERRAIN_BIOME_SHADING_POLICY.mapAlignedCryosphere, true);

const alwaysWinter = worldAt(0.145, 0.115);
const sameLatitudeEast = worldAt(0.58, 0.115);
const farEast = worldAt(0.84, 0.115);
const north = worldAt(0.175, 0.285);
const south = worldAt(0.175, 0.62);

const winterClimate = northClimateWeightsAtWorldXZ(alwaysWinter.x, alwaysWinter.z);
const eastClimate = northClimateWeightsAtWorldXZ(sameLatitudeEast.x, sameLatitudeEast.z);
const farEastClimate = northClimateWeightsAtWorldXZ(farEast.x, farEast.z);
const northClimate = northClimateWeightsAtWorldXZ(north.x, north.z);

assert.ok(winterClimate.permanentIce > 0.95, `always-winter permanent ice too weak: ${winterClimate.permanentIce}`);
assert.ok(winterClimate.tundra > 0.95, `always-winter tundra too weak: ${winterClimate.tundra}`);
assert.ok(northClimate.tundra > northClimate.permanentIce, 'canonical North should be tundra-dominant south of always-winter');
assert.equal(eastClimate.permanentIce, 0, 'same-latitude east must not inherit Westeros permanent ice');
assert.equal(farEastClimate.permanentIce, 0, 'far-east must not inherit Westeros permanent ice');
assert.equal(farEastClimate.tundra, 0, 'far-east must not inherit Westeros tundra');

const winterSnow = snowAt(alwaysWinter);
const eastSnow = snowAt(sameLatitudeEast);
const southSnow = snowAt(south);
assert.equal(winterSnow.mapAlignedClimate, true);
assert.ok(winterSnow.snowAmount > 0.80, `always-winter lowland must retain snow: ${winterSnow.snowAmount}`);
assert.ok(eastSnow.snowAmount < 0.05, `same-latitude east lowland must remain snow-free: ${eastSnow.snowAmount}`);
assert.ok(southSnow.snowAmount < 0.05, `temperate south lowland must remain snow-free: ${southSnow.snowAmount}`);
assert.ok(winterSnow.permanentIce > eastSnow.permanentIce, 'X/Z climate must separate Westeros from eastern same-latitude ground');

const winterShore = coastalCryosphereProfileAtWorldXZ(alwaysWinter.x, alwaysWinter.z);
const eastShore = coastalCryosphereProfileAtWorldXZ(sameLatitudeEast.x, sameLatitudeEast.z);
assert.ok(winterShore.weight > 0.5, `always-winter coastal ice too weak: ${winterShore.weight}`);
assert.equal(eastShore.weight, 0, 'same-latitude east must not receive Westeros coastal ice apron');
assert.ok(winterShore.shallowWeight > eastShore.shallowWeight, 'glacial shallow-water tint must follow map-aligned cryosphere');

const winterSnowline = mountainSnowlineAtWorldXZ(alwaysWinter.x, alwaysWinter.z);
const eastSnowline = mountainSnowlineAtWorldXZ(sameLatitudeEast.x, sameLatitudeEast.z);
assert.ok(winterSnowline.startMeters < 25, `always-winter snowline should be near sea level: ${winterSnowline.startMeters}`);
assert.ok(eastSnowline.startMeters >= TERRAIN_BIOME_SHADING_POLICY.snowAltitudeStartMeters - 1e-9,
  `same-latitude east must retain temperate snowline: ${eastSnowline.startMeters}`);

const winterColour = colourAt(alwaysWinter);
const eastColour = colourAt(sameLatitudeEast);
const winterToSnow = distance(winterColour, TERRAIN_BIOME_PALETTE.SNOW);
const eastToSnow = distance(eastColour, TERRAIN_BIOME_PALETTE.SNOW);
const eastToGrass = Math.min(
  distance(eastColour, TERRAIN_BIOME_PALETTE.GRASS_LOW),
  distance(eastColour, TERRAIN_BIOME_PALETTE.MEADOW),
  distance(eastColour, TERRAIN_BIOME_PALETTE.GRASS_MID),
);
assert.ok(winterToSnow < eastToSnow, 'always-winter terrain must render visibly closer to snow than same-latitude east');
assert.ok(eastToGrass < eastToSnow, 'same-latitude east lowland should render as temperate ground rather than snow');

console.log(JSON.stringify({
  policyId: TERRAIN_BIOME_SHADING_POLICY.id,
  winterClimate,
  eastClimate,
  northClimate,
  winterSnow: { snowAmount: winterSnow.snowAmount, snowSupply: winterSnow.snowSupply },
  eastSnow: { snowAmount: eastSnow.snowAmount, snowSupply: eastSnow.snowSupply },
  winterShore: { weight: winterShore.weight, shallowWeight: winterShore.shallowWeight },
  eastShore: { weight: eastShore.weight, shallowWeight: eastShore.shallowWeight },
  winterSnowline: { startMeters: winterSnowline.startMeters, fullMeters: winterSnowline.fullMeters },
  eastSnowline: { startMeters: eastSnowline.startMeters, fullMeters: eastSnowline.fullMeters },
}, null, 2));
