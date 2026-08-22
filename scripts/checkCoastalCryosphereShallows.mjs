#!/usr/bin/env node
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { WORLD_SCALE } from '../src/3d/config.js';
import { WORLD_REFERENCE_ALIGNMENT } from '../src/3d/world/worldReferenceAlignment.js';
import {
  TERRAIN_BIOME_PALETTE,
  TERRAIN_BIOME_SHADING_POLICY,
  coastalCryosphereProfileAtWorldZ,
  resolveTerrainBiomeColor,
} from '../src/3d/world/terrainBiomeShading.js';

function worldZForNormalizedMapY(normalizedY) {
  const centerMapY = (WORLD_SCALE.MAP_BOUNDS.minY + WORLD_SCALE.MAP_BOUNDS.maxY) * 0.5;
  const mapY = normalizedY * WORLD_REFERENCE_ALIGNMENT.mapCanvasHeightUnits;
  return (mapY - centerMapY) * WORLD_SCALE.METERS_PER_MAP_UNIT;
}

function profileAt(normalizedY) {
  return coastalCryosphereProfileAtWorldZ(worldZForNormalizedMapY(normalizedY));
}

function colorAt(normalizedY, height) {
  return resolveTerrainBiomeColor(new THREE.Color(), {
    heightAboveSeaMeters: height,
    slopeDegrees: 2,
    rockWeight: 0,
    snowWeight: 0,
    worldX: 120,
    worldZ: worldZForNormalizedMapY(normalizedY),
  });
}

function distance(a, b) {
  return Math.hypot(a.r - b.r, a.g - b.g, a.b - b.b);
}

const south = profileAt(0.62);
const tundra = profileAt(0.33);
const transition = profileAt(0.22);
const north = profileAt(0.06);

assert.equal(south.shallowWeight, 0,
  'temperate coast must not receive glacial shallow-water tint');
assert(tundra.shallowWeight > 0,
  'tundra coast must begin a restrained shallow-water freeze signal');
assert(transition.shallowWeight > tundra.shallowWeight,
  'shallow-water freeze must strengthen through the permanent-ice transition');
assert(north.shallowWeight > transition.shallowWeight,
  'far-north coast must own the strongest shallow-water freeze signal');
assert(north.shallowWeight <= TERRAIN_BIOME_SHADING_POLICY.northShallowIceStrength + 1e-9,
  'far-north shallow freeze must remain within its authored strength ceiling');

assert(tundra.shallowDepthMeters >= TERRAIN_BIOME_SHADING_POLICY.northShallowIceTundraDepthMeters - 1e-9,
  'tundra shallow freeze must use at least the authored frost depth');
assert(north.shallowDepthMeters > tundra.shallowDepthMeters,
  'permanent-ice shallow freeze must extend deeper than tundra frost');
assert(north.shallowDepthMeters <= TERRAIN_BIOME_SHADING_POLICY.northShallowIceDepthMeters + 1e-9,
  'permanent-ice shallow freeze must not exceed its authored depth ceiling');

const southNearSurface = colorAt(0.62, -0.25);
const tundraNearSurface = colorAt(0.33, -0.25);
const northNearSurface = colorAt(0.06, -0.25);
const northMidShallow = colorAt(0.06, -1.2);
const northBeyondShallow = colorAt(0.06, -3.0);

assert(distance(northNearSurface, TERRAIN_BIOME_PALETTE.GLACIAL_SHALLOW)
    < distance(southNearSurface, TERRAIN_BIOME_PALETTE.GLACIAL_SHALLOW),
  'far-north near-surface seabed must visually move toward glacial shallow water');
assert(distance(tundraNearSurface, TERRAIN_BIOME_PALETTE.GLACIAL_SHALLOW)
    < distance(southNearSurface, TERRAIN_BIOME_PALETTE.GLACIAL_SHALLOW),
  'tundra near-surface shallows must begin cooling before permanent ice');
assert(distance(northNearSurface, TERRAIN_BIOME_PALETTE.GLACIAL_SHALLOW)
    < distance(northMidShallow, TERRAIN_BIOME_PALETTE.GLACIAL_SHALLOW),
  'glacial shallow tint must be strongest nearest the waterline');
assert(distance(northMidShallow, TERRAIN_BIOME_PALETTE.GLACIAL_SHALLOW)
    < distance(northBeyondShallow, TERRAIN_BIOME_PALETTE.GLACIAL_SHALLOW),
  'glacial shallow tint must fade with depth instead of recolouring the deep seabed');
assert(distance(northBeyondShallow, TERRAIN_BIOME_PALETTE.NORTH_SEABED)
    < distance(northBeyondShallow, TERRAIN_BIOME_PALETTE.GLACIAL_SHALLOW),
  'deep far-north seabed must remain governed by the northern seabed palette');

let previousDepth = profileAt(0.06).shallowDepthMeters;
let maxDepthStep = 0;
for (let normalizedY = 0.07; normalizedY <= 0.40; normalizedY += 0.01) {
  const currentDepth = profileAt(normalizedY).shallowDepthMeters;
  maxDepthStep = Math.max(maxDepthStep, Math.abs(currentDepth - previousDepth));
  assert(Math.abs(currentDepth - previousDepth) < 0.22,
    `shallow freeze depth must remain continuous near normalizedY=${normalizedY.toFixed(2)}`);
  previousDepth = currentDepth;
}

assert.equal(TERRAIN_BIOME_SHADING_POLICY.heightAuthorityUnchanged, true,
  'shallow-water cryosphere tint must remain render-only');

console.log('[checkCoastalCryosphereShallows] PASS', JSON.stringify({
  policy: TERRAIN_BIOME_SHADING_POLICY.id,
  tundraShallowWeight: tundra.shallowWeight,
  transitionShallowWeight: transition.shallowWeight,
  northShallowWeight: north.shallowWeight,
  tundraShallowDepthMeters: tundra.shallowDepthMeters,
  northShallowDepthMeters: north.shallowDepthMeters,
  maxDepthStep,
}));
