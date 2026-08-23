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

function distance(a, b) {
  return Math.hypot(a.r - b.r, a.g - b.g, a.b - b.b);
}

const tundra = profileAt(0.175, 0.30);
const transition = profileAt(0.155, 0.20);
const permanentIce = profileAt(0.145, 0.115);
const sameLatitudeEast = profileAt(0.72, 0.115);

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

const southWaterline = colorAt(0.52, 0.62, 0.34, 2);
assert(distance(southWaterline, TERRAIN_BIOME_PALETTE.SHORE_SAND)
    < distance(southWaterline, TERRAIN_BIOME_PALETTE.WET_FROZEN_SHORE),
  'temperate shoreline must remain warm sand rather than cold wet intertidal ground');

const tundraWaterline = colorAt(0.175, 0.30, 0.34, 2);
const tundraUpperShore = colorAt(0.175, 0.30, 1.25, 2);
const tundraSteepWaterline = colorAt(0.175, 0.30, 0.34, 36);
const wetPalette = TERRAIN_BIOME_PALETTE.WET_FROZEN_SHORE;

assert(distance(tundraWaterline, wetPalette) < distance(tundraUpperShore, wetPalette),
  'low tundra waterline should read wetter/darker than the upper frozen shore');
assert(distance(tundraWaterline, wetPalette) < distance(tundraSteepWaterline, wetPalette),
  'steep rocky headlands should shed the flat intertidal tint');
assert(distance(tundraWaterline, TERRAIN_BIOME_PALETTE.SHORE_SAND)
    > distance(tundraWaterline, wetPalette),
  'tundra waterline must remain inside the cold intertidal palette family');

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
  tundra: { intertidalWeight: tundra.intertidalWeight, intertidalTopMeters: tundra.intertidalTopMeters },
  transition: { intertidalWeight: transition.intertidalWeight, intertidalTopMeters: transition.intertidalTopMeters },
  permanentIce: { intertidalWeight: permanentIce.intertidalWeight, intertidalTopMeters: permanentIce.intertidalTopMeters },
  sameLatitudeEast: { intertidalWeight: sameLatitudeEast.intertidalWeight },
  maxAdjacentStep,
}, null, 2));
