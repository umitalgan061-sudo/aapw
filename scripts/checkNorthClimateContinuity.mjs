#!/usr/bin/env node
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { WORLD_SCALE } from '../src/3d/config.js';
import { WORLD_REFERENCE_ALIGNMENT } from '../src/3d/world/worldReferenceAlignment.js';
import {
  TERRAIN_BIOME_SHADING_POLICY,
  northClimateWeightsAtWorldZ,
  resolveTerrainBiomeColor,
} from '../src/3d/world/terrainBiomeShading.js';

function worldZForNormalizedMapY(normalizedY) {
  const centerMapY = (WORLD_SCALE.MAP_BOUNDS.minY + WORLD_SCALE.MAP_BOUNDS.maxY) * 0.5;
  const mapY = normalizedY * WORLD_REFERENCE_ALIGNMENT.mapCanvasHeightUnits;
  return (mapY - centerMapY) * WORLD_SCALE.METERS_PER_MAP_UNIT;
}

function colorAt(normalizedY) {
  const worldZ = worldZForNormalizedMapY(normalizedY);
  return resolveTerrainBiomeColor(new THREE.Color(), {
    heightAboveSeaMeters: 24,
    slopeDegrees: 5,
    rockWeight: 0.05,
    snowWeight: 0,
    worldX: 900,
    worldZ,
  });
}

const P = TERRAIN_BIOME_SHADING_POLICY;
const start = Math.max(0.01, P.northIceFullNormalizedY - 0.02);
const end = Math.min(0.50, P.northTundraFadeNormalizedY + 0.05);
const samples = 180;
let previousClimate = null;
let previousColor = null;
let maxColorStep = 0;
let sawPartialIce = false;
let sawPartialTundra = false;

for (let i = 0; i <= samples; i += 1) {
  const normalizedY = start + (end - start) * (i / samples);
  const worldZ = worldZForNormalizedMapY(normalizedY);
  const climate = northClimateWeightsAtWorldZ(worldZ);
  const color = colorAt(normalizedY);

  assert(climate.permanentIce >= 0 && climate.permanentIce <= 1, 'permanentIce weight must remain normalized');
  assert(climate.tundra >= 0 && climate.tundra <= 1, 'tundra weight must remain normalized');
  if (climate.permanentIce > 0 && climate.permanentIce < 1) sawPartialIce = true;
  if (climate.tundra > 0 && climate.tundra < 1) sawPartialTundra = true;

  if (previousClimate) {
    assert(climate.permanentIce <= previousClimate.permanentIce + 1e-12,
      'permanent ice must fade monotonically when travelling south');
    assert(climate.tundra <= previousClimate.tundra + 1e-12,
      'tundra influence must fade monotonically when travelling south');
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
  `north palette must not create a visible latitude seam; maximum adjacent color step was ${maxColorStep}`);

const north = northClimateWeightsAtWorldZ(worldZForNormalizedMapY(P.northIceFullNormalizedY * 0.5));
const south = northClimateWeightsAtWorldZ(worldZForNormalizedMapY(P.northTundraFadeNormalizedY + 0.08));
assert(north.permanentIce > 0.99, 'far side of ice threshold must remain fully frozen');
assert.equal(south.permanentIce, 0, 'south of transition must have no permanent-ice floor');
assert.equal(south.tundra, 0, 'south of tundra fade must have no latitude tundra override');

console.log('[checkNorthClimateContinuity] PASS', JSON.stringify({
  policy: P.id,
  samples: samples + 1,
  maxColorStep,
  startNormalizedY: start,
  endNormalizedY: end,
}));
