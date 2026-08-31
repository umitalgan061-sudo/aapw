#!/usr/bin/env node
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { WORLD_SCALE } from '../src/3d/config.js';
import { normalizedReferenceToWorldXZ } from '../src/3d/world/worldReferenceAlignment.js';
import {
  TERRAIN_BIOME_PALETTE,
  TERRAIN_BIOME_SHADING_POLICY,
  coastalCryosphereProfileAtWorldXZ,
  resolveTerrainBiomeColor,
} from '../src/3d/world/terrainBiomeShading.js';

function worldAt(normalizedX, normalizedY) {
  return normalizedReferenceToWorldXZ(
    normalizedX,
    normalizedY,
    WORLD_SCALE.MAP_BOUNDS,
    WORLD_SCALE.METERS_PER_MAP_UNIT,
  );
}

function profileAt(normalizedX, normalizedY) {
  const world = worldAt(normalizedX, normalizedY);
  return coastalCryosphereProfileAtWorldXZ(world.x, world.z);
}

function colorAt(normalizedX, normalizedY, height, slope = 2) {
  const world = worldAt(normalizedX, normalizedY);
  return resolveTerrainBiomeColor(new THREE.Color(), {
    heightAboveSeaMeters: height,
    slopeDegrees: slope,
    worldX: world.x,
    worldZ: world.z,
  });
}

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

function smoothstep(edge0, edge1, value) {
  const t = clamp01((value - edge0) / Math.max(1e-9, edge1 - edge0));
  return t * t * (3 - 2 * t);
}

function intertidalBandAmount(profile, height, slope) {
  const P = TERRAIN_BIOME_SHADING_POLICY;
  const landEmergence = smoothstep(0, P.shoreEmergenceFullMeters, height);
  return (1 - smoothstep(0, profile.intertidalTopMeters, height))
    * landEmergence
    * profile.intertidalWeight
    * (1 - smoothstep(P.northIntertidalSlopeFadeStartDegrees, P.northIntertidalSlopeFadeFullDegrees, slope));
}

function distance(a, b) {
  return Math.hypot(a.r - b.r, a.g - b.g, a.b - b.b);
}

function nearestCryosphereDistance(color) {
  return Math.min(
    distance(color, TERRAIN_BIOME_PALETTE.WET_FROZEN_SHORE),
    distance(color, TERRAIN_BIOME_PALETTE.FROZEN_SHORE),
    distance(color, TERRAIN_BIOME_PALETTE.GLACIAL_SHORE),
    distance(color, TERRAIN_BIOME_PALETTE.COASTAL_ICE),
    distance(color, TERRAIN_BIOME_PALETTE.SNOW),
  );
}

const tundra = profileAt(0.175, 0.30);
const transition = profileAt(0.155, 0.20);
const permanentIce = profileAt(0.145, 0.115);
const sameLatitudeEast = profileAt(0.72, 0.115);
const temperateSouth = profileAt(0.52, 0.62);

assert.equal(tundra.permanentIce, 0,
  'tundra fixture must isolate the authored tundra intertidal contribution');
assert(tundra.intertidalWeight > 0,
  'canonical North tundra must retain a visible cold intertidal signal');
assert(transition.intertidalWeight > tundra.intertidalWeight,
  'intertidal darkening should strengthen through the ice transition');
assert(permanentIce.intertidalWeight > transition.intertidalWeight,
  'permanent-ice coastline should own the strongest intertidal signal');
assert(tundra.intertidalTopMeters < transition.intertidalTopMeters,
  'intertidal vertical reach should widen through the ice transition');
assert(transition.intertidalTopMeters < permanentIce.intertidalTopMeters,
  'permanent ice should have the widest intertidal vertical reach');
assert(permanentIce.intertidalWeight <= TERRAIN_BIOME_SHADING_POLICY.northIntertidalIceStrength + 1e-9,
  'permanent-ice intertidal weight must remain bounded by authored strength');
assert(tundra.intertidalWeight <= TERRAIN_BIOME_SHADING_POLICY.northIntertidalTundraStrength + 1e-9,
  'pure tundra intertidal weight must remain bounded by authored tundra strength');
assert.equal(sameLatitudeEast.intertidalWeight, 0,
  'same-latitude east must not inherit Westeros frozen intertidal treatment');
assert.equal(temperateSouth.intertidalWeight, 0,
  'temperate south must not receive the frozen intertidal climate signal');

const southWaterline = colorAt(0.52, 0.62, 0.34, 2);
const southUpperShore = colorAt(0.52, 0.62, 1.25, 2);
const southSandDistance = distance(southWaterline, TERRAIN_BIOME_PALETTE.SHORE_SAND);
const southUpperSandDistance = distance(southUpperShore, TERRAIN_BIOME_PALETTE.SHORE_SAND);
assert(southSandDistance < southUpperSandDistance,
  'temperate waterline must move toward warm shore sand relative to the upper shore');

const tundraWaterline = colorAt(0.175, 0.30, 0.34, 2);
const tundraUpperShore = colorAt(0.175, 0.30, 1.25, 2);
const tundraSteepWaterline = colorAt(0.175, 0.30, 0.34, 36);
const tundraWaterlineIntertidal = intertidalBandAmount(tundra, 0.34, 2);
const tundraUpperIntertidal = intertidalBandAmount(tundra, 1.25, 2);
const tundraSteepIntertidal = intertidalBandAmount(tundra, 0.34, 36);

assert(tundraWaterlineIntertidal > tundraUpperIntertidal,
  'flat tundra waterline must receive more intertidal tint than the upper frozen shore');
assert(tundraWaterlineIntertidal > tundraSteepIntertidal,
  'steep rocky headlands must shed the flat intertidal contribution');
assert(nearestCryosphereDistance(tundraWaterline)
    < distance(tundraWaterline, TERRAIN_BIOME_PALETTE.SHORE_SAND),
  'tundra waterline must remain inside the combined cold shore/ice/snow palette family');
assert.notDeepEqual(tundraWaterline.toArray(), tundraUpperShore.toArray(),
  'tundra waterline and upper shore must remain visibly distinct');
assert.notDeepEqual(tundraWaterline.toArray(), tundraSteepWaterline.toArray(),
  'tundra flat and steep waterline samples must remain visibly distinct');

let previousWeight = permanentIce.intertidalWeight;
let maxAdjacentStep = 0;
for (let normalizedY = 0.125; normalizedY <= 0.34; normalizedY += 0.005) {
  const sample = profileAt(0.145 + Math.max(0, normalizedY - 0.115) * 0.15, normalizedY);
  maxAdjacentStep = Math.max(maxAdjacentStep, Math.abs(sample.intertidalWeight - previousWeight));
  assert(Math.abs(sample.intertidalWeight - previousWeight) < 0.045,
    `intertidal climate transition must remain continuous near normalizedY=${normalizedY.toFixed(3)}`);
  previousWeight = sample.intertidalWeight;
}

assert.equal(TERRAIN_BIOME_SHADING_POLICY.renderOnly, true,
  'intertidal palette refinement must stay render-only');
assert.equal(TERRAIN_BIOME_SHADING_POLICY.heightAuthorityUnchanged, true,
  'intertidal palette refinement must never become terrain/collider height authority');

console.log(JSON.stringify({
  tundra: {
    intertidalWeight: tundra.intertidalWeight,
    intertidalTopMeters: tundra.intertidalTopMeters,
    waterlineIntertidal: tundraWaterlineIntertidal,
    upperIntertidal: tundraUpperIntertidal,
    steepIntertidal: tundraSteepIntertidal,
  },
  transition: { intertidalWeight: transition.intertidalWeight, intertidalTopMeters: transition.intertidalTopMeters },
  permanentIce: { intertidalWeight: permanentIce.intertidalWeight, intertidalTopMeters: permanentIce.intertidalTopMeters },
  sameLatitudeEast: { intertidalWeight: sameLatitudeEast.intertidalWeight },
  temperateSouth: { intertidalWeight: temperateSouth.intertidalWeight, southSandDistance, southUpperSandDistance },
  maxAdjacentStep,
}, null, 2));
