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

function colorAt(normalizedX, normalizedY, height) {
  const world = worldAt(normalizedX, normalizedY);
  return resolveTerrainBiomeColor(new THREE.Color(), {
    heightAboveSeaMeters: height,
    slopeDegrees: 2,
    rockWeight: 0,
    snowWeight: 0,
    worldX: world.x,
    worldZ: world.z,
  });
}

function distance(a, b) {
  return Math.hypot(a.r - b.r, a.g - b.g, a.b - b.b);
}

const SOUTH = Object.freeze({ x: 0.22, y: 0.62 });
const TUNDRA = Object.freeze({ x: 0.175, y: 0.30 });
const TRANSITION = Object.freeze({ x: 0.155, y: 0.20 });
const NORTH = Object.freeze({ x: 0.145, y: 0.115 });

const south = profileAt(SOUTH.x, SOUTH.y);
const tundra = profileAt(TUNDRA.x, TUNDRA.y);
const transition = profileAt(TRANSITION.x, TRANSITION.y);
const north = profileAt(NORTH.x, NORTH.y);

assert.equal(south.shallowWeight, 0,
  'temperate coast must not receive glacial shallow-water tint');
assert(tundra.shallowWeight > 0,
  'canonical North tundra coast must begin a restrained shallow-water freeze signal');
assert(transition.shallowWeight > tundra.shallowWeight,
  'shallow-water freeze must strengthen through the permanent-ice transition');
assert(north.shallowWeight > transition.shallowWeight,
  'lands-always-winter coast must own the strongest shallow-water freeze signal');
assert(north.shallowWeight <= TERRAIN_BIOME_SHADING_POLICY.northShallowIceStrength + 1e-9,
  'far-north shallow freeze must remain within its authored strength ceiling');

assert(tundra.shallowDepthMeters >= TERRAIN_BIOME_SHADING_POLICY.northShallowIceTundraDepthMeters - 1e-9,
  'tundra shallow freeze must use at least the authored frost depth');
assert(north.shallowDepthMeters > tundra.shallowDepthMeters,
  'permanent-ice shallow freeze must extend deeper than tundra frost');
assert(north.shallowDepthMeters <= TERRAIN_BIOME_SHADING_POLICY.northShallowIceDepthMeters + 1e-9,
  'permanent-ice shallow freeze must not exceed its authored depth ceiling');

const southNearSurface = colorAt(SOUTH.x, SOUTH.y, -0.25);
const tundraNearSurface = colorAt(TUNDRA.x, TUNDRA.y, -0.25);
const northNearSurface = colorAt(NORTH.x, NORTH.y, -0.25);
const northMidShallow = colorAt(NORTH.x, NORTH.y, -1.2);
const northBeyondShallow = colorAt(NORTH.x, NORTH.y, -3.0);

assert(distance(northNearSurface, TERRAIN_BIOME_PALETTE.GLACIAL_SHALLOW)
    < distance(southNearSurface, TERRAIN_BIOME_PALETTE.GLACIAL_SHALLOW),
  'map-aligned far-north near-surface seabed must visually move toward glacial shallow water');
assert(distance(tundraNearSurface, TERRAIN_BIOME_PALETTE.GLACIAL_SHALLOW)
    < distance(southNearSurface, TERRAIN_BIOME_PALETTE.GLACIAL_SHALLOW),
  'canonical North near-surface shallows must begin cooling before permanent ice');
assert(distance(northNearSurface, TERRAIN_BIOME_PALETTE.GLACIAL_SHALLOW)
    < distance(northMidShallow, TERRAIN_BIOME_PALETTE.GLACIAL_SHALLOW),
  'glacial shallow tint must be strongest nearest the waterline');
assert(distance(northMidShallow, TERRAIN_BIOME_PALETTE.GLACIAL_SHALLOW)
    < distance(northBeyondShallow, TERRAIN_BIOME_PALETTE.GLACIAL_SHALLOW),
  'glacial shallow tint must fade with depth instead of recolouring the deep seabed');
assert(distance(northBeyondShallow, TERRAIN_BIOME_PALETTE.NORTH_SEABED)
    < distance(northBeyondShallow, TERRAIN_BIOME_PALETTE.GLACIAL_SHALLOW),
  'deep far-north seabed must remain governed by the northern seabed palette');

let previousDepth = north.shallowDepthMeters;
let maxDepthStep = 0;
for (let step = 1; step <= 24; step += 1) {
  const t = step / 24;
  const normalizedX = NORTH.x + (TUNDRA.x - NORTH.x) * t;
  const normalizedY = NORTH.y + (0.40 - NORTH.y) * t;
  const currentDepth = profileAt(normalizedX, normalizedY).shallowDepthMeters;
  maxDepthStep = Math.max(maxDepthStep, Math.abs(currentDepth - previousDepth));
  assert(Math.abs(currentDepth - previousDepth) < 0.22,
    `map-aligned shallow freeze depth must remain continuous at path step=${step}`);
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
