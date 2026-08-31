#!/usr/bin/env node
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { WORLD_SCALE } from '../src/3d/config.js';
import { normalizedReferenceToWorldXZ } from '../src/3d/world/worldReferenceAlignment.js';
import {
  TERRAIN_BIOME_PALETTE,
  TERRAIN_BIOME_SHADING_POLICY,
  resolveTerrainBiomeColor,
  resolveTerrainSnowCoverage,
} from '../src/3d/world/terrainBiomeShading.js';

function worldAt(normalizedX, normalizedY) {
  return normalizedReferenceToWorldXZ(
    normalizedX,
    normalizedY,
    WORLD_SCALE.MAP_BOUNDS,
    WORLD_SCALE.METERS_PER_MAP_UNIT,
  );
}

function lowlandSnow(normalizedX, normalizedY) {
  const world = worldAt(normalizedX, normalizedY);
  return resolveTerrainSnowCoverage({
    heightAboveSeaMeters: 18,
    slopeDegrees: 4,
    snowWeight: 0,
    worldX: world.x,
    worldZ: world.z,
  });
}

function lowlandColor(normalizedX, normalizedY) {
  const world = worldAt(normalizedX, normalizedY);
  return resolveTerrainBiomeColor(new THREE.Color(), {
    heightAboveSeaMeters: 18,
    slopeDegrees: 4,
    rockWeight: 0,
    snowWeight: 0,
    worldX: world.x,
    worldZ: world.z,
  });
}

function colorDistance(a, b) {
  return Math.hypot(a.r - b.r, a.g - b.g, a.b - b.b);
}

const tundra = lowlandSnow(0.175, 0.30);
const iceEdge = lowlandSnow(0.155, 0.20);
const farNorth = lowlandSnow(0.145, 0.115);
const sameLatitudeEast = lowlandSnow(0.72, 0.20);

assert.equal(TERRAIN_BIOME_SHADING_POLICY.renderOnly, true,
  'mixed-ice lowland harmony must remain render-only');
assert.equal(TERRAIN_BIOME_SHADING_POLICY.heightAuthorityUnchanged, true,
  'mixed-ice lowland harmony must not become a terrain/collider height authority');
assert(TERRAIN_BIOME_SHADING_POLICY.northIceTransitionLowlandTintGain > 0,
  'mixed-ice lowland harmony requires a positive authored transition gain');
assert(
  TERRAIN_BIOME_SHADING_POLICY.northIceTransitionLowlandTintGain
    <= TERRAIN_BIOME_SHADING_POLICY.northIceLowlandTintStrength / 4 + 1e-9,
  'transition tint gain must stay low enough for total glacial tint to remain monotonic toward the permanent-ice core',
);

assert.equal(tundra.permanentIce, 0,
  'canonical tundra fixture must remain outside permanent ice');
assert.equal(tundra.mixedIceTransition, 0,
  'pure tundra must not receive mixed-ice lowland support');
assert.equal(tundra.glacialIceTintTransition, 0,
  'pure tundra must not receive transition glacial tint');

assert(iceEdge.permanentIce > 0.5 && iceEdge.permanentIce < 0.65,
  'canonical ICE EDGE fixture must remain a mixed permanent-ice belt rather than a full ice core');
assert(iceEdge.mixedIceTransition > 0.9,
  'canonical ICE EDGE should sit near the peak of the bounded mixed-ice support bell');
assert(iceEdge.glacialIceTintTransition > 0.06,
  'canonical ICE EDGE lowland should gain measurable glacial tint support beyond the base permanent-ice tint');
assert(iceEdge.glacialIceTint > iceEdge.glacialIceTintBase + 0.05,
  'mixed-belt support must materially strengthen lowland glacial continuity at ICE EDGE');
assert(iceEdge.glacialIceTint < farNorth.glacialIceTint,
  'ICE EDGE lowland must remain visually subordinate to the full permanent-ice core');

assert(farNorth.permanentIce > 0.99,
  'far-north fixture must remain inside the full permanent-ice core');
assert(farNorth.mixedIceTransition < 1e-9,
  'full permanent ice must not receive transition-only support');
assert(farNorth.glacialIceTintTransition < 1e-9,
  'far-north core tint must remain unchanged by the mixed-belt bridge');

assert.equal(sameLatitudeEast.permanentIce, 0,
  'same-latitude eastern control must remain outside the map-aligned Westeros cryosphere');
assert.equal(sameLatitudeEast.glacialIceTintTransition, 0,
  'same-latitude east must not receive mixed-ice lowland glacial tint');

const tundraColor = lowlandColor(0.175, 0.30);
const iceEdgeColor = lowlandColor(0.155, 0.20);
const farNorthColor = lowlandColor(0.145, 0.115);
const eastColor = lowlandColor(0.72, 0.20);

assert(
  colorDistance(iceEdgeColor, TERRAIN_BIOME_PALETTE.GLACIAL_ICE)
    < colorDistance(tundraColor, TERRAIN_BIOME_PALETTE.GLACIAL_ICE),
  'ICE EDGE lowland must read more glacial than canonical pure tundra lowland',
);
assert(
  colorDistance(farNorthColor, TERRAIN_BIOME_PALETTE.GLACIAL_ICE)
    < colorDistance(iceEdgeColor, TERRAIN_BIOME_PALETTE.GLACIAL_ICE),
  'full permanent-ice lowland must remain more glacial than the mixed ICE EDGE belt',
);
assert(
  colorDistance(eastColor, TERRAIN_BIOME_PALETTE.GLACIAL_ICE)
    > colorDistance(iceEdgeColor, TERRAIN_BIOME_PALETTE.GLACIAL_ICE),
  'same-latitude east must stay perceptually outside the glacial lowland family',
);

let previousTint = 0;
let maxStep = 0;
for (let permanentIce = 0; permanentIce <= 1.000001; permanentIce += 0.025) {
  const mixed = 4 * permanentIce * (1 - permanentIce);
  const tint = permanentIce * TERRAIN_BIOME_SHADING_POLICY.northIceLowlandTintStrength
    + mixed * TERRAIN_BIOME_SHADING_POLICY.northIceTransitionLowlandTintGain;
  maxStep = Math.max(maxStep, tint - previousTint);
  assert(tint + 1e-9 >= previousTint,
    `authored mixed-ice glacial tint must remain monotonic toward the core near permanentIce=${permanentIce.toFixed(3)}`);
  previousTint = tint;
}

console.log(JSON.stringify({
  policyId: TERRAIN_BIOME_SHADING_POLICY.id,
  iceEdgePermanentIce: iceEdge.permanentIce,
  iceEdgeMixedSupport: iceEdge.mixedIceTransition,
  iceEdgeBaseTint: iceEdge.glacialIceTintBase,
  iceEdgeTransitionTint: iceEdge.glacialIceTintTransition,
  iceEdgeFinalTint: iceEdge.glacialIceTint,
  farNorthFinalTint: farNorth.glacialIceTint,
  maxAuthoredTintStep: maxStep,
  heightAuthorityUnchanged: TERRAIN_BIOME_SHADING_POLICY.heightAuthorityUnchanged,
}, null, 2));
