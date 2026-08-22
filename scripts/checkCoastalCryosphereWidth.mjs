#!/usr/bin/env node
import assert from 'node:assert/strict';
import { WORLD_SCALE } from '../src/3d/config.js';
import { WORLD_REFERENCE_ALIGNMENT } from '../src/3d/world/worldReferenceAlignment.js';
import {
  TERRAIN_BIOME_SHADING_POLICY,
  coastalCryosphereProfileAtWorldZ,
} from '../src/3d/world/terrainBiomeShading.js';

function worldZForNormalizedMapY(normalizedY) {
  const centerMapY = (WORLD_SCALE.MAP_BOUNDS.minY + WORLD_SCALE.MAP_BOUNDS.maxY) * 0.5;
  const mapY = normalizedY * WORLD_REFERENCE_ALIGNMENT.mapCanvasHeightUnits;
  return (mapY - centerMapY) * WORLD_SCALE.METERS_PER_MAP_UNIT;
}

function profileAt(normalizedY) {
  return coastalCryosphereProfileAtWorldZ(worldZForNormalizedMapY(normalizedY));
}

const south = profileAt(0.62);
const tundra = profileAt(0.33);
const transition = profileAt(0.22);
const permanentIce = profileAt(0.06);

assert.equal(south.weight, 0,
  'temperate coast must not receive a cryosphere apron');
assert(tundra.weight > 0,
  'tundra coast must retain a restrained frost apron');
assert(transition.weight > tundra.weight,
  'coastal cryosphere strength must increase through the permanent-ice transition');
assert(permanentIce.weight > transition.weight,
  'far-north coast must own the strongest cryosphere apron');

assert.equal(tundra.topMeters, TERRAIN_BIOME_SHADING_POLICY.northCoastalIceTundraTopMeters,
  'pure tundra coast must use the narrow authored frost-apron height');
assert.equal(tundra.fullMeters, TERRAIN_BIOME_SHADING_POLICY.northCoastalIceTundraFullMeters,
  'pure tundra coast must use the narrow authored full-strength height');
assert.equal(permanentIce.topMeters, TERRAIN_BIOME_SHADING_POLICY.northCoastalIceTopMeters,
  'far-north permanent ice must use the wider authored glacial apron height');
assert.equal(permanentIce.fullMeters, TERRAIN_BIOME_SHADING_POLICY.northCoastalIceFullMeters,
  'far-north permanent ice must use the wider authored full-strength height');
assert(transition.topMeters > tundra.topMeters && transition.topMeters < permanentIce.topMeters,
  'apron top height must interpolate smoothly through the climate transition');
assert(transition.fullMeters > tundra.fullMeters && transition.fullMeters < permanentIce.fullMeters,
  'full-strength apron height must interpolate smoothly through the climate transition');
assert(permanentIce.topMeters > tundra.topMeters * 2,
  'permanent-ice shoreline should reach materially farther inland/uphill than tundra frost');

let previous = profileAt(0.06);
let maxTopStep = 0;
let maxFullStep = 0;
for (let normalizedY = 0.07; normalizedY <= 0.38; normalizedY += 0.01) {
  const current = profileAt(normalizedY);
  maxTopStep = Math.max(maxTopStep, Math.abs(current.topMeters - previous.topMeters));
  maxFullStep = Math.max(maxFullStep, Math.abs(current.fullMeters - previous.fullMeters));
  assert(current.topMeters <= previous.topMeters + 1e-9,
    `coastal apron top must not widen while moving south near normalizedY=${normalizedY.toFixed(2)}`);
  assert(current.fullMeters <= previous.fullMeters + 1e-9,
    `coastal apron full-strength height must not widen while moving south near normalizedY=${normalizedY.toFixed(2)}`);
  assert(current.fullMeters < current.topMeters,
    `coastal apron must preserve a valid fade interval near normalizedY=${normalizedY.toFixed(2)}`);
  previous = current;
}

assert(maxTopStep < 0.35,
  `coastal apron top must remain continuous between adjacent climate samples; max step=${maxTopStep}`);
assert(maxFullStep < 0.05,
  `coastal apron full-strength height must remain continuous; max step=${maxFullStep}`);
assert.equal(TERRAIN_BIOME_SHADING_POLICY.heightAuthorityUnchanged, true,
  'shoreline cryosphere width must remain render-only');

console.log('[checkCoastalCryosphereWidth] PASS', JSON.stringify({
  policy: TERRAIN_BIOME_SHADING_POLICY.id,
  tundra,
  transition,
  permanentIce,
  maxTopStep,
  maxFullStep,
}));
