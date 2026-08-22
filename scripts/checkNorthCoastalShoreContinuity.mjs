#!/usr/bin/env node
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { WORLD_SCALE } from '../src/3d/config.js';
import { normalizedReferenceToWorldXZ } from '../src/3d/world/worldReferenceAlignment.js';
import {
  TERRAIN_BIOME_PALETTE,
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

function sample({ normalizedX, normalizedY, height = 0.5, slope = 2, rockWeight = 0, snowWeight = 0 }) {
  const world = worldAt(normalizedX, normalizedY);
  return resolveTerrainBiomeColor(new THREE.Color(), {
    heightAboveSeaMeters: height,
    slopeDegrees: slope,
    rockWeight,
    snowWeight,
    worldX: world.x,
    worldZ: world.z,
  });
}

function climateAt(normalizedX, normalizedY) {
  const world = worldAt(normalizedX, normalizedY);
  return northClimateWeightsAtWorldXZ(world.x, world.z);
}

function distance(a, b) {
  return Math.hypot(a.r - b.r, a.g - b.g, a.b - b.b);
}

function rgbDelta(a, b) {
  return Math.max(Math.abs(a.r - b.r), Math.abs(a.g - b.g), Math.abs(a.b - b.b));
}

function saturation(color) {
  const max = Math.max(color.r, color.g, color.b);
  const min = Math.min(color.r, color.g, color.b);
  return max === 0 ? 0 : (max - min) / max;
}

const P = TERRAIN_BIOME_SHADING_POLICY;
assert.equal(P.heightAuthorityUnchanged, true, 'shoreline treatment must stay render-only');
assert.equal(P.mapAlignedCryosphere, true, 'shoreline continuity must exercise the map-aligned cryosphere');

const anchors = Object.freeze({
  farNorth: Object.freeze({ x: 0.145, y: 0.115 }),
  transition: Object.freeze({ x: 0.155, y: 0.20 }),
  tundra: Object.freeze({ x: 0.175, y: 0.30 }),
  temperate: Object.freeze({ x: 0.185, y: 0.50 }),
  sameLatitudeEast: Object.freeze({ x: 0.72, y: 0.115 }),
});

const farNorthClimate = climateAt(anchors.farNorth.x, anchors.farNorth.y);
const tundraClimate = climateAt(anchors.tundra.x, anchors.tundra.y);
const temperateClimate = climateAt(anchors.temperate.x, anchors.temperate.y);
const eastClimate = climateAt(anchors.sameLatitudeEast.x, anchors.sameLatitudeEast.y);
assert(farNorthClimate.permanentIce > 0.95, 'always-winter coast must remain permanent ice');
assert.equal(tundraClimate.permanentIce, 0, 'canonical North tundra fixture must be outside permanent ice');
assert(tundraClimate.tundra > 0.5, 'canonical North tundra fixture must retain strong tundra influence');
assert.equal(temperateClimate.tundra, 0, 'temperate south fixture must leave the north cryosphere');
assert.equal(eastClimate.permanentIce, 0, 'same-latitude east must not inherit Westeros permanent ice');
assert.equal(eastClimate.tundra, 0, 'same-latitude east must not inherit Westeros tundra');

// Follow a canonical Westeros path instead of averaging the full map width. The cryosphere is an
// authored X+Z field, so averaging Westeros with Essos would erase the very geography being tested.
const path = [anchors.farNorth, anchors.transition, anchors.tundra, anchors.temperate];
let previous = null;
let maxRgbStep = 0;
let pathSamples = 0;
for (let segment = 0; segment < path.length - 1; segment += 1) {
  const from = path[segment];
  const to = path[segment + 1];
  const steps = 140;
  for (let i = segment === 0 ? 0 : 1; i <= steps; i += 1) {
    const t = i / steps;
    const normalizedX = from.x + (to.x - from.x) * t;
    const normalizedY = from.y + (to.y - from.y) * t;
    const color = sample({ normalizedX, normalizedY, height: 0.5, slope: 2 });
    if (previous) {
      const step = rgbDelta(previous, color);
      maxRgbStep = Math.max(maxRgbStep, step);
      assert(step < 0.06,
        `map-aligned frozen shoreline must not form a geographic colour seam; RGB step=${step} at x=${normalizedX.toFixed(4)}, y=${normalizedY.toFixed(4)}`);
    }
    previous = color.clone();
    pathSamples += 1;
  }
}

const farNorthShore = sample({ ...anchors.farNorth, normalizedX: anchors.farNorth.x, normalizedY: anchors.farNorth.y });
const tundraShore = sample({ normalizedX: anchors.tundra.x, normalizedY: anchors.tundra.y });
const temperateShore = sample({ normalizedX: anchors.temperate.x, normalizedY: anchors.temperate.y });
const eastShore = sample({ normalizedX: anchors.sameLatitudeEast.x, normalizedY: anchors.sameLatitudeEast.y });
assert(distance(farNorthShore, TERRAIN_BIOME_PALETTE.GLACIAL_SHORE)
    < distance(farNorthShore, TERRAIN_BIOME_PALETTE.SHORE_SAND),
  'permanent-ice coast must stay glacial rather than sandy');
assert(distance(tundraShore, TERRAIN_BIOME_PALETTE.FROZEN_SHORE)
    < distance(tundraShore, TERRAIN_BIOME_PALETTE.SHORE_SAND),
  'canonical North tundra coast must stay closer to frozen shore than warm sand');
assert(distance(temperateShore, TERRAIN_BIOME_PALETTE.SHORE_SAND)
    < distance(temperateShore, TERRAIN_BIOME_PALETTE.FROZEN_SHORE),
  'temperate Westeros coast must preserve warm natural sand');
assert(distance(eastShore, TERRAIN_BIOME_PALETTE.SHORE_SAND)
    < distance(eastShore, TERRAIN_BIOME_PALETTE.FROZEN_SHORE),
  'same-latitude east coast must remain temperate rather than inheriting Westeros ice');

let maxWaterlineStep = 0;
for (const anchor of [anchors.farNorth, anchors.transition, anchors.tundra, anchors.temperate]) {
  let previousElevation = null;
  let previousHeight = null;
  let maxSubmergedStep = 0;
  let maxLandStep = 0;
  for (let i = 0; i <= 180; i += 1) {
    const height = -3 + i * 0.05;
    const color = sample({ normalizedX: anchor.x, normalizedY: anchor.y, height, slope: 2 });
    if (previousElevation) {
      const step = rgbDelta(previousElevation, color);
      const crossesWaterSurface = previousHeight < 0 && height >= 0;
      if (crossesWaterSurface) {
        maxWaterlineStep = Math.max(maxWaterlineStep, step);
        assert(step < 0.30,
          `waterline palette contrast must remain bounded; RGB step=${step} at x=${anchor.x}, y=${anchor.y}, h=${height.toFixed(2)}`);
      } else {
        if (height < 0) maxSubmergedStep = Math.max(maxSubmergedStep, step);
        else maxLandStep = Math.max(maxLandStep, step);
        assert(step < 0.18,
          `shore elevation treatment must not spike within one medium; RGB step=${step} at x=${anchor.x}, y=${anchor.y}, h=${height.toFixed(2)}`);
      }
    }
    previousElevation = color.clone();
    previousHeight = height;
  }
  assert(maxSubmergedStep > 0.001, 'submerged elevation sweep must traverse a visible shallow-water change');
  assert(maxLandStep > 0.001, 'land elevation sweep must traverse a visible shoreline change');
}

const flatNorth = sample({ normalizedX: 0.145, normalizedY: 0.115, height: 0.8, slope: 2 });
const midSlopeNorth = sample({ normalizedX: 0.145, normalizedY: 0.115, height: 0.8, slope: 26 });
const cliffNorth = sample({ normalizedX: 0.145, normalizedY: 0.115, height: 0.8, slope: 58, rockWeight: 0.85 });
assert(distance(cliffNorth, TERRAIN_BIOME_PALETTE.ROCK_COOL)
    < distance(flatNorth, TERRAIN_BIOME_PALETTE.ROCK_COOL),
  'steep northern headland should move toward cool rock relative to a flat frozen cove');
assert(distance(cliffNorth, flatNorth) > 0.025,
  'flat frozen coast and steep rocky headland must not collapse to one colour');
assert(distance(midSlopeNorth, TERRAIN_BIOME_PALETTE.SHORE_SAND)
    > distance(temperateShore, TERRAIN_BIOME_PALETTE.SHORE_SAND),
  'moderately sloped far-north coast must not reveal a warm sand ring');

const southSeabed = sample({ normalizedX: anchors.temperate.x, normalizedY: anchors.temperate.y, height: -1.5, slope: 2 });
const tundraSeabed = sample({ normalizedX: anchors.tundra.x, normalizedY: anchors.tundra.y, height: -1.5, slope: 2 });
const iceSeabed = sample({ normalizedX: anchors.farNorth.x, normalizedY: anchors.farNorth.y, height: -1.5, slope: 2 });
const deepIceSeabed = sample({ normalizedX: anchors.farNorth.x, normalizedY: anchors.farNorth.y, height: -3.0, slope: 2 });
assert(distance(iceSeabed, TERRAIN_BIOME_PALETTE.GLACIAL_SHALLOW)
    < distance(southSeabed, TERRAIN_BIOME_PALETTE.GLACIAL_SHALLOW),
  'permanent-ice shallows should move toward GLACIAL_SHALLOW near the coast');
assert(distance(deepIceSeabed, TERRAIN_BIOME_PALETTE.NORTH_SEABED)
    < distance(iceSeabed, TERRAIN_BIOME_PALETTE.NORTH_SEABED),
  'deeper permanent-ice seabed should return toward NORTH_SEABED below the shallow glacial band');
assert(distance(tundraSeabed, southSeabed) > 0.008,
  'tundra shallows should begin cooling before permanent ice');
assert(saturation(iceSeabed) < 0.55,
  'northern shallow water must stay restrained rather than becoming saturated cyan');

const authoredSnow = sample({ normalizedX: anchors.tundra.x, normalizedY: anchors.tundra.y, height: 2.2, slope: 4, snowWeight: 1 });
const authoredRock = sample({ normalizedX: anchors.tundra.x, normalizedY: anchors.tundra.y, height: 2.2, slope: 52, rockWeight: 1 });
assert(distance(authoredSnow, TERRAIN_BIOME_PALETTE.SNOW)
    < distance(tundraShore, TERRAIN_BIOME_PALETTE.SNOW),
  'canonical snow weight must remain visible above frozen-shore tint');
assert(distance(authoredRock, TERRAIN_BIOME_PALETTE.ROCK_COOL)
    < distance(tundraShore, TERRAIN_BIOME_PALETTE.ROCK_COOL),
  'canonical rock weight must remain visible on coastal cliffs');

for (const [label, color] of Object.entries({
  farNorthShore, tundraShore, temperateShore, eastShore, flatNorth, midSlopeNorth, cliffNorth,
  southSeabed, tundraSeabed, iceSeabed, deepIceSeabed, authoredSnow, authoredRock,
})) {
  assert(Number.isFinite(color.r) && Number.isFinite(color.g) && Number.isFinite(color.b), `${label} must be finite`);
  assert(color.r >= 0 && color.r <= 1 && color.g >= 0 && color.g <= 1 && color.b >= 0 && color.b <= 1,
    `${label} must remain inside linear RGB display bounds`);
}

console.log('[checkNorthCoastalShoreContinuity] PASS', JSON.stringify({
  policy: P.id,
  pathSamples,
  maxRgbStep,
  maxWaterlineStep,
  farNorthShore: farNorthShore.getHexString(),
  tundraShore: tundraShore.getHexString(),
  temperateShore: temperateShore.getHexString(),
  eastShore: eastShore.getHexString(),
  cliffNorth: cliffNorth.getHexString(),
  iceSeabed: iceSeabed.getHexString(),
  deepIceSeabed: deepIceSeabed.getHexString(),
}));
