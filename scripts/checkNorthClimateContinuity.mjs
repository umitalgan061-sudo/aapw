#!/usr/bin/env node
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { WORLD_SCALE } from '../src/3d/config.js';
import { normalizedReferenceToWorldXZ } from '../src/3d/world/worldReferenceAlignment.js';
import {
  TERRAIN_BIOME_SHADING_POLICY,
  northClimateWeightsAtWorldXZ,
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

function sampleAt(normalizedY, normalizedX = 0.145) {
  const world = worldAt(normalizedX, normalizedY);
  return {
    climate: northClimateWeightsAtWorldXZ(world.x, world.z),
    color: resolveTerrainBiomeColor(new THREE.Color(), {
      heightAboveSeaMeters: 24,
      slopeDegrees: 5,
      rockWeight: 0.05,
      snowWeight: 0,
      worldX: world.x,
      worldZ: world.z,
    }),
  };
}

const start = 0.08;
const end = 0.38;
const samples = 180;
let previousClimate = null;
let previousColor = null;
let maxColorStep = 0;
let sawPartialIce = false;
let sawPartialTundra = false;

for (let i = 0; i <= samples; i += 1) {
  const normalizedY = start + (end - start) * (i / samples);
  const { climate, color } = sampleAt(normalizedY);

  assert(climate.permanentIce >= 0 && climate.permanentIce <= 1, 'permanentIce weight must remain normalized');
  assert(climate.tundra >= 0 && climate.tundra <= 1, 'tundra weight must remain normalized');
  if (climate.permanentIce > 0 && climate.permanentIce < 1) sawPartialIce = true;
  if (climate.tundra > 0 && climate.tundra < 1) sawPartialTundra = true;

  if (previousClimate) {
    assert(climate.permanentIce <= previousClimate.permanentIce + 1e-12,
      'permanent ice must fade monotonically when travelling south through canonical Westeros');
    assert(climate.tundra <= previousClimate.tundra + 1e-12,
      'tundra influence must fade monotonically when travelling south through canonical Westeros');
  }
  if (previousColor) {
    const step = Math.hypot(color.r - previousColor.r, color.g - previousColor.g, color.b - previousColor.b);
    maxColorStep = Math.max(maxColorStep, step);
  }

  previousClimate = climate;
  previousColor = color;
}

assert(sawPartialIce, 'fixture must cross the smooth permanent-ice transition');
assert(sawPartialTundra, 'fixture must cross the smooth tundra transition');
assert(maxColorStep < 0.12,
  `north palette must not create a visible climate seam; maximum adjacent color step was ${maxColorStep}`);

const north = sampleAt(0.115).climate;
const south = sampleAt(0.42).climate;
const sameLatitudeEast = sampleAt(0.115, 0.72).climate;
assert(north.permanentIce > 0.99, 'always-winter centre must remain fully frozen');
assert.equal(south.permanentIce, 0, 'south of transition must have no permanent-ice floor');
assert.equal(south.tundra, 0, 'south of tundra fade must have no north override');
assert.equal(sameLatitudeEast.permanentIce, 0, 'same-latitude east must not inherit Westeros permanent ice');
assert.equal(sameLatitudeEast.tundra, 0, 'same-latitude east must not inherit Westeros tundra');

console.log('[checkNorthClimateContinuity] PASS', JSON.stringify({
  policy: TERRAIN_BIOME_SHADING_POLICY.id,
  samples: samples + 1,
  maxColorStep,
  startNormalizedY: start,
  endNormalizedY: end,
}));