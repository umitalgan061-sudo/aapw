#!/usr/bin/env node
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { WORLD_SCALE } from '../src/3d/config.js';
import { normalizedReferenceToWorldXZ } from '../src/3d/world/worldReferenceAlignment.js';
import {
  TERRAIN_BIOME_SHADING_POLICY,
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

function sampleColor(normalizedX, normalizedY, height) {
  const world = worldAt(normalizedX, normalizedY);
  return resolveTerrainBiomeColor(new THREE.Color(), {
    heightAboveSeaMeters: height,
    slopeDegrees: height <= 1 ? 2 : 4,
    rockWeight: 0,
    snowWeight: 0,
    worldX: world.x,
    worldZ: world.z,
  });
}

function distance(a, b) {
  return Math.hypot(a.r - b.r, a.g - b.g, a.b - b.b);
}

function measure(normalizedX, normalizedY) {
  const shore = sampleColor(normalizedX, normalizedY, 0.5);
  const lowland = sampleColor(normalizedX, normalizedY, 18);
  return Object.freeze({
    shore,
    lowland,
    distance: distance(shore, lowland),
    shoreHex: `#${shore.getHexString()}`,
    lowlandHex: `#${lowland.getHexString()}`,
  });
}

const farNorth = measure(0.145, 0.115);
const iceEdge = measure(0.155, 0.20);
const tundra = measure(0.175, 0.30);

assert.equal(TERRAIN_BIOME_SHADING_POLICY.renderOnly, true,
  'shore/lowland palette harmony must remain render-only');
assert.equal(TERRAIN_BIOME_SHADING_POLICY.heightAuthorityUnchanged, true,
  'shore/lowland palette harmony must not become terrain or collider height authority');
assert(TERRAIN_BIOME_SHADING_POLICY.northIceTransitionLowlandTintGain > 0,
  'ICE EDGE shore/lowland harmony requires the bounded mixed-ice lowland tint bridge');

// The previous browser artifact measured the ICE EDGE lowland/shore pair around 0.173 in the
// same Three.js linear colour distance. The mixed-ice bridge must make a measurable improvement
// while preserving enough contrast for shoreline readability.
assert(iceEdge.distance < 0.17,
  `ICE EDGE lowland must stay visually connected to its glacial shoreline; distance=${iceEdge.distance}`);
assert(iceEdge.distance > 0.025,
  'ICE EDGE shoreline and lowland must not collapse into one flat colour');

assert(farNorth.distance < 0.06,
  `full permanent-ice shore and lowland should remain a tight cryosphere family; distance=${farNorth.distance}`);
assert(farNorth.distance < iceEdge.distance,
  'full permanent ice should remain more internally colour-coherent than the mixed ICE EDGE belt');
assert(tundra.distance > farNorth.distance,
  'pure tundra should retain more shore/lowland separation than the full permanent-ice core');

console.log(JSON.stringify({
  policyId: TERRAIN_BIOME_SHADING_POLICY.id,
  farNorth: {
    shoreHex: farNorth.shoreHex,
    lowlandHex: farNorth.lowlandHex,
    lowlandToShore: farNorth.distance,
  },
  iceEdge: {
    shoreHex: iceEdge.shoreHex,
    lowlandHex: iceEdge.lowlandHex,
    lowlandToShore: iceEdge.distance,
  },
  tundra: {
    shoreHex: tundra.shoreHex,
    lowlandHex: tundra.lowlandHex,
    lowlandToShore: tundra.distance,
  },
  heightAuthorityUnchanged: TERRAIN_BIOME_SHADING_POLICY.heightAuthorityUnchanged,
}, null, 2));
