#!/usr/bin/env node
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { WORLD_SCALE } from '../src/3d/config.js';
import { WORLD_REFERENCE_ALIGNMENT } from '../src/3d/world/worldReferenceAlignment.js';
import {
  TERRAIN_BIOME_PALETTE,
  TERRAIN_BIOME_SHADING_POLICY,
  northClimateWeightsAtWorldZ,
  resolveTerrainBiomeColor,
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

function distance(a, b) {
  return Math.hypot(a.r - b.r, a.g - b.g, a.b - b.b);
}

function luminance(color) {
  return 0.2126 * color.r + 0.7152 * color.g + 0.0722 * color.b;
}

const lowland = colorAt({ normalizedY: 0.62, height: 18, slope: 4, worldX: 120 });
const meadowVariant = colorAt({ normalizedY: 0.62, height: 18, slope: 4, worldX: 2100 });
const shore = colorAt({ normalizedY: 0.62, height: 0.5, slope: 2, worldX: 120 });
const upland = colorAt({ normalizedY: 0.62, height: 150, slope: 8, worldX: 120 });
const cliff = colorAt({ normalizedY: 0.62, height: 150, slope: 52, rockWeight: 0.9, worldX: 120 });
const tundra = colorAt({ normalizedY: 0.33, height: 18, slope: 4, worldX: 120 });
const farNorth = colorAt({ normalizedY: 0.06, height: 18, slope: 4, worldX: 120 });
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

const northClimate = northClimateWeightsAtWorldZ(worldZForNormalizedMapY(0.06));
assert(northClimate.permanentIce > 0.95, 'far-north palette fixture must sit inside permanent ice');
assert.equal(TERRAIN_BIOME_SHADING_POLICY.heightAuthorityUnchanged, true,
  'geographic palette must remain render-only and never become terrain height authority');

for (const [label, color] of Object.entries({ lowland, meadowVariant, shore, upland, cliff, tundra, farNorth, highSnow })) {
  assert(Number.isFinite(color.r) && Number.isFinite(color.g) && Number.isFinite(color.b), `${label} color must be finite`);
  assert(color.r >= 0 && color.r <= 1 && color.g >= 0 && color.g <= 1 && color.b >= 0 && color.b <= 1,
    `${label} color must remain inside displayable linear RGB bounds`);
}

console.log('[checkTerrainGeographicPalette] PASS', JSON.stringify({
  policy: TERRAIN_BIOME_SHADING_POLICY.id,
  northPermanentIce: northClimate.permanentIce,
  lowland: lowland.getHexString(),
  shore: shore.getHexString(),
  upland: upland.getHexString(),
  cliff: cliff.getHexString(),
  tundra: tundra.getHexString(),
  farNorth: farNorth.getHexString(),
  highSnow: highSnow.getHexString(),
}));
