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

function canonicalNorthXAt(normalizedY) {
  const winter = { x: 0.145, y: 0.115 };
  const north = { x: 0.175, y: 0.285 };
  const south = { x: 0.22, y: 0.52 };
  if (normalizedY <= winter.y) return winter.x;
  if (normalizedY <= north.y) {
    const t = (normalizedY - winter.y) / (north.y - winter.y);
    return winter.x + (north.x - winter.x) * t;
  }
  const t = Math.min(1, (normalizedY - north.y) / (south.y - north.y));
  return north.x + (south.x - north.x) * t;
}

function sampleAt(normalizedY, normalizedX = canonicalNorthXAt(normalizedY)) {
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

// Start at the authored always-winter centre. Sampling north of this point and then travelling
// south first approaches the core, so a global southward-monotonic assertion would be invalid.
const start = 0.115;
const end = 0.52;
const samples = 240;
let previousClimate = null;
let previousColor = null;
let maxColorStep = 0;
let maxPermanentIceStep = 0;
let maxTundraStep = 0;
let maxSouthwardIceGain = 0;
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
    const iceDelta = climate.permanentIce - previousClimate.permanentIce;
    const tundraDelta = climate.tundra - previousClimate.tundra;
    maxPermanentIceStep = Math.max(maxPermanentIceStep, Math.abs(iceDelta));
    maxTundraStep = Math.max(maxTundraStep, Math.abs(tundraDelta));
    maxSouthwardIceGain = Math.max(maxSouthwardIceGain, iceDelta);
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
assert(maxSouthwardIceGain < 1e-9,
  `permanent ice must not strengthen south of the always-winter centre; maximum gain was ${maxSouthwardIceGain}`);
assert(maxPermanentIceStep < 0.035,
  `permanent-ice field must remain locally continuous; maximum adjacent step was ${maxPermanentIceStep}`);
assert(maxTundraStep < 0.035,
  `combined winter+north tundra field must remain locally continuous; maximum adjacent step was ${maxTundraStep}`);
assert(maxColorStep < 0.12,
  `north palette must not create a visible climate seam; maximum adjacent color step was ${maxColorStep}`);

const winterCore = sampleAt(0.115, 0.145).climate;
const canonicalNorth = sampleAt(0.285, 0.175).climate;
const south = sampleAt(0.52, 0.22).climate;
const sameLatitudeEast = sampleAt(0.115, 0.72).climate;
assert(winterCore.permanentIce > 0.99, 'always-winter centre must remain fully frozen');
assert(canonicalNorth.tundra > 0.85, 'canonical North centre must retain strong tundra influence');
assert(canonicalNorth.permanentIce < winterCore.permanentIce,
  'canonical North must be less permanently frozen than the always-winter core');
assert.equal(south.permanentIce, 0, 'south of transition must have no permanent-ice floor');
assert.equal(south.tundra, 0, 'south of tundra fade must have no north override');
assert.equal(sameLatitudeEast.permanentIce, 0, 'same-latitude east must not inherit Westeros permanent ice');
assert.equal(sameLatitudeEast.tundra, 0, 'same-latitude east must not inherit Westeros tundra');

console.log('[checkNorthClimateContinuity] PASS', JSON.stringify({
  policy: TERRAIN_BIOME_SHADING_POLICY.id,
  samples: samples + 1,
  maxColorStep,
  maxPermanentIceStep,
  maxTundraStep,
  maxSouthwardIceGain,
  startNormalizedY: start,
  endNormalizedY: end,
}));