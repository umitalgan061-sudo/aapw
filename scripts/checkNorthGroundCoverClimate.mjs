#!/usr/bin/env node
import assert from 'node:assert/strict';
import { WORLD_SCALE } from '../src/3d/config.js';
import {
  WORLD_REFERENCE_ALIGNMENT,
  normalizedReferenceToWorldXZ,
} from '../src/3d/world/worldReferenceAlignment.js';
import {
  NORTH_GROUND_COVER_POLICY,
  northGroundCoverProfileAtWorldXZ,
  northGroundCoverProfileAtWorldZ,
  acceptsNorthGroundCover,
  acceptsNorthGroundCoverAtWorldXZ,
} from '../src/3d/world/northGroundCoverClimate.js';

function worldZForNormalizedMapY(normalizedY) {
  const centerMapY = (WORLD_SCALE.MAP_BOUNDS.minY + WORLD_SCALE.MAP_BOUNDS.maxY) * 0.5;
  const mapY = normalizedY * WORLD_REFERENCE_ALIGNMENT.mapCanvasHeightUnits;
  return (mapY - centerMapY) * WORLD_SCALE.METERS_PER_MAP_UNIT;
}

function worldXZ(normalizedX, normalizedY) {
  return normalizedReferenceToWorldXZ(
    normalizedX,
    normalizedY,
    WORLD_SCALE.MAP_BOUNDS,
    WORLD_SCALE.METERS_PER_MAP_UNIT,
  );
}

// Legacy latitude contract remains stable until all historical callers migrate to X/Z.
const north = northGroundCoverProfileAtWorldZ(worldZForNormalizedMapY(0.05));
const iceEdge = northGroundCoverProfileAtWorldZ(worldZForNormalizedMapY(0.20));
const tundra = northGroundCoverProfileAtWorldZ(worldZForNormalizedMapY(0.32));
const transitionSouth = northGroundCoverProfileAtWorldZ(worldZForNormalizedMapY(0.37));
const south = northGroundCoverProfileAtWorldZ(worldZForNormalizedMapY(0.62));

assert.equal(north.policyId, NORTH_GROUND_COVER_POLICY.id);
assert.equal(north.grassDensity, 0, 'permanent ice must contain no ordinary green wind grass');
assert(north.heightScale < tundra.heightScale, 'far-north survivors would have to be shorter than tundra cover');
assert(iceEdge.grassDensity <= tundra.grassDensity, 'grass density must recover southward from ice into tundra');
assert(tundra.grassDensity > 0 && tundra.grassDensity < 0.6, 'tundra must retain only sparse hardy cover');
assert(transitionSouth.grassDensity > tundra.grassDensity, 'grass density must recover continuously toward temperate ground');
assert.equal(south.grassDensity, 1, 'temperate south must preserve the existing Run-180 density');
assert.equal(south.heightScale, 1, 'temperate south must preserve existing patch scale');
assert.equal(south.frostAmount, 0, 'temperate south must not receive frozen tint');
assert(north.frostAmount > tundra.frostAmount && tundra.frostAmount > south.frostAmount,
  'frost tint must weaken monotonically while travelling south');

for (const profile of [north, iceEdge, tundra, transitionSouth, south]) {
  assert(profile.grassDensity >= 0 && profile.grassDensity <= 1, 'density must remain normalized');
  assert(profile.heightScale >= 0 && profile.heightScale <= 1, 'height scale must remain normalized');
  assert(profile.frostAmount >= 0 && profile.frostAmount <= 1, 'frost amount must remain normalized');
  for (const channel of ['r', 'g', 'b']) {
    assert(profile.rgb[channel] >= 0 && profile.rgb[channel] <= 1, `rgb.${channel} must remain normalized`);
  }
}

assert.equal(acceptsNorthGroundCover(worldZForNormalizedMapY(0.05), 0), false,
  'even a zero RNG roll must not place ordinary grass in permanent ice');
assert.equal(acceptsNorthGroundCover(worldZForNormalizedMapY(0.62), 0.999999), true,
  'temperate south must accept every valid [0,1) density roll');
const tundraZ = worldZForNormalizedMapY(0.32);
const tundraDensity = northGroundCoverProfileAtWorldZ(tundraZ).grassDensity;
assert.equal(acceptsNorthGroundCover(tundraZ, Math.max(0, tundraDensity - 1e-6)), true);
assert.equal(acceptsNorthGroundCover(tundraZ, Math.min(0.999999, tundraDensity + 1e-6)), false);
assert.equal(acceptsNorthGroundCover(tundraZ, Number.NaN), false, 'invalid rolls must fail closed');

// Dense legacy sweep: no discontinuous latitude wall and no southward regression.
let previous = northGroundCoverProfileAtWorldZ(worldZForNormalizedMapY(0.04));
let maxDensityStep = 0;
let maxColorStep = 0;
for (let i = 1; i <= 400; i += 1) {
  const normalizedY = 0.04 + (0.48 - 0.04) * (i / 400);
  const current = northGroundCoverProfileAtWorldZ(worldZForNormalizedMapY(normalizedY));
  assert(current.grassDensity + 1e-12 >= previous.grassDensity,
    `grass density regressed while travelling south at normalizedY=${normalizedY}`);
  const densityStep = Math.abs(current.grassDensity - previous.grassDensity);
  const colorStep = Math.hypot(
    current.rgb.r - previous.rgb.r,
    current.rgb.g - previous.rgb.g,
    current.rgb.b - previous.rgb.b,
  );
  maxDensityStep = Math.max(maxDensityStep, densityStep);
  maxColorStep = Math.max(maxColorStep, colorStep);
  previous = current;
}
assert(maxDensityStep < 0.04, `ground-cover density transition is too abrupt: ${maxDensityStep}`);
assert(maxColorStep < 0.02, `ground-cover tint transition is too abrupt: ${maxColorStep}`);

// Canonical map-aligned contract: same latitude must not imply the same cryosphere everywhere.
const alwaysWinterWorld = worldXZ(0.145, 0.115);
const sameLatitudeEastWorld = worldXZ(0.82, 0.115);
const canonicalNorthWorld = worldXZ(0.19, 0.235);
const temperateWorld = worldXZ(0.52, 0.62);
const alwaysWinter = northGroundCoverProfileAtWorldXZ(alwaysWinterWorld.x, alwaysWinterWorld.z);
const sameLatitudeEast = northGroundCoverProfileAtWorldXZ(sameLatitudeEastWorld.x, sameLatitudeEastWorld.z);
const canonicalNorth = northGroundCoverProfileAtWorldXZ(canonicalNorthWorld.x, canonicalNorthWorld.z);
const temperate = northGroundCoverProfileAtWorldXZ(temperateWorld.x, temperateWorld.z);

assert.equal(alwaysWinter.grassDensity, 0,
  'canonical lands-always-winter must reject ordinary grass');
assert(alwaysWinter.permanentIce > 0.9,
  'canonical lands-always-winter center must carry strong permanent ice');
assert.equal(sameLatitudeEast.permanentIce, 0,
  'far-east ground at the same latitude must not inherit Westeros permanent ice');
assert(sameLatitudeEast.grassDensity > alwaysWinter.grassDensity,
  'same-latitude east must recover ordinary cover outside the canonical cryosphere');
assert(canonicalNorth.tundra > canonicalNorth.permanentIce,
  'canonical North should primarily read as tundra south of always-winter');
assert(canonicalNorth.grassDensity > 0 && canonicalNorth.grassDensity < 1,
  'canonical North should retain sparse hardy cover');
assert.equal(temperate.grassDensity, 1,
  'map-aligned temperate ground must preserve ordinary grass density');
assert.equal(acceptsNorthGroundCoverAtWorldXZ(alwaysWinterWorld.x, alwaysWinterWorld.z, 0), false);
assert.equal(acceptsNorthGroundCoverAtWorldXZ(temperateWorld.x, temperateWorld.z, 0.999999), true);
assert.equal(acceptsNorthGroundCoverAtWorldXZ(temperateWorld.x, temperateWorld.z, Number.NaN), false);

console.log('[checkNorthGroundCoverClimate] PASS', JSON.stringify({
  policy: NORTH_GROUND_COVER_POLICY.id,
  northDensity: north.grassDensity,
  tundraDensity: tundra.grassDensity,
  southDensity: south.grassDensity,
  alwaysWinterDensity: alwaysWinter.grassDensity,
  sameLatitudeEastDensity: sameLatitudeEast.grassDensity,
  canonicalNorthDensity: canonicalNorth.grassDensity,
  maxDensityStep,
  maxColorStep,
}));
