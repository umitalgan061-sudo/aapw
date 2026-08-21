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
const southSeabed = colorAt({ normalizedY: 0.62, height: -1.8, slope: 2, worldX: 120 });
const upland = colorAt({ normalizedY: 0.62, height: 150, slope: 8, worldX: 120 });
const cliff = colorAt({ normalizedY: 0.62, height: 150, slope: 52, rockWeight: 0.9, worldX: 120 });
const tundra = colorAt({ normalizedY: 0.33, height: 18, slope: 4, worldX: 120 });
const tundraShore = colorAt({ normalizedY: 0.33, height: 0.5, slope: 2, worldX: 120 });
const tundraSeabed = colorAt({ normalizedY: 0.33, height: -1.8, slope: 2, worldX: 120 });
const iceTransitionShore = colorAt({ normalizedY: 0.22, height: 0.5, slope: 2, worldX: 120 });
const farNorth = colorAt({ normalizedY: 0.06, height: 18, slope: 4, worldX: 120 });
const farNorthShore = colorAt({ normalizedY: 0.06, height: 0.5, slope: 2, worldX: 120 });
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

// Shoreline climate regression. Warm sand is still valid in the temperate south, but must not bleed
// through the tundra/cryosphere where it creates an implausible yellow ring around frozen coasts.
assert(distance(shore, TERRAIN_BIOME_PALETTE.SHORE_SAND) < distance(shore, TERRAIN_BIOME_PALETTE.FROZEN_SHORE),
  'temperate shoreline should remain perceptually closer to warm sand than frozen shore');
assert(distance(tundraShore, TERRAIN_BIOME_PALETTE.FROZEN_SHORE) < distance(tundraShore, TERRAIN_BIOME_PALETTE.SHORE_SAND),
  'tundra shoreline should prefer frozen shore over warm sand');
assert(distance(iceTransitionShore, TERRAIN_BIOME_PALETTE.GLACIAL_SHORE) < distance(iceTransitionShore, TERRAIN_BIOME_PALETTE.SHORE_SAND),
  'ice-transition shoreline should prefer glacial/frozen tones over warm sand');
assert(distance(farNorthShore, TERRAIN_BIOME_PALETTE.GLACIAL_SHORE) < distance(farNorthShore, TERRAIN_BIOME_PALETTE.SHORE_SAND),
  'permanent-ice shoreline should read glacial rather than sandy');
assert(distance(southSeabed, farNorthSeabed) > 0.03,
  'submerged northern shallows should not share the same warm/green seabed tint as temperate coasts');
assert(distance(farNorthSeabed, TERRAIN_BIOME_PALETTE.NORTH_SEABED) < distance(southSeabed, TERRAIN_BIOME_PALETTE.NORTH_SEABED),
  'far-north seabed should move toward the cold northern seabed palette');
assert(distance(tundraSeabed, southSeabed) > 0.01,
  'tundra shallows should begin cooling before the permanent-ice boundary');

// Sample the entire climate transition to ensure the frozen-shore preference changes continuously,
// without a sudden yellow beach seam at either north climate boundary.
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
  southSeabed,
  upland,
  cliff,
  tundra,
  tundraShore,
  tundraSeabed,
  iceTransitionShore,
  farNorth,
  farNorthShore,
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
  lowland: lowland.getHexString(),
  shore: shore.getHexString(),
  southSeabed: southSeabed.getHexString(),
  upland: upland.getHexString(),
  cliff: cliff.getHexString(),
  tundra: tundra.getHexString(),
  tundraShore: tundraShore.getHexString(),
  iceTransitionShore: iceTransitionShore.getHexString(),
  farNorth: farNorth.getHexString(),
  farNorthShore: farNorthShore.getHexString(),
  farNorthSeabed: farNorthSeabed.getHexString(),
  highSnow: highSnow.getHexString(),
}));