#!/usr/bin/env node

import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  WORLD_ASSET_GEOGRAPHY_PLACEMENT_BRIDGE_POLICY,
  evaluateWorldAssetGeographyOnly,
} from '../src/3d/world/WorldAssetGeographyPlacementBridge.js';

const centerSurface = {
  x: 120,
  z: 220,
  height: 42,
  slopeDegrees: 9,
  moisture: 0.72,
  biome: 'meadow',
  snow: 0.03,
  lithic: 0.31,
  erosion: 0.24,
  deposition: 0.46,
  shelter: 0.71,
  exposure: 0.29,
  coastDistance: 210,
  riverDistance: 180,
  lakeDistance: 260,
  roadDistance: 70,
  settlementDistance: 160,
  normalizedX: 0.34,
  normalizedY: 0.52,
};

const conflictingFootprintSample = {
  x: 128,
  z: 228,
  height: 410,
  slopeDegrees: 54,
  moisture: 0.06,
  biome: 'scree mountain',
  snow: 0.74,
  lithic: 0.92,
  erosion: 0.84,
  deposition: 0.08,
  shelter: 0.12,
  exposure: 0.91,
  coastDistance: 900,
  riverDistance: 800,
  lakeDistance: 700,
  roadDistance: 40,
  settlementDistance: 50,
  normalizedX: 0.34,
  normalizedY: 0.52,
};

const object = new THREE.Object3D();
object.position.set(centerSurface.x, centerSurface.height, centerSurface.z);
object.userData.worldPlacementSurface = centerSurface;
object.userData.worldPlacementFootprint = {
  samples: [conflictingFootprintSample],
};

const result = evaluateWorldAssetGeographyOnly(object, {
  metadata: { family: 'rock' },
});

assert.equal(WORLD_ASSET_GEOGRAPHY_PLACEMENT_BRIDGE_POLICY.transformAuthorityPreserved, true);
assert.equal(result.ok, true);
assert.equal(result.profile.family, 'rock');
assert.equal(result.profile.surface.heightMeters, centerSurface.height);
assert.equal(result.profile.surface.moisture, centerSurface.moisture);
assert.equal(result.profile.surface.slopeDegrees, centerSurface.slopeDegrees);
assert.equal(result.profile.surface.biome, centerSurface.biome);
assert.equal(result.profile.surface.snow, centerSurface.snow);
assert.equal(result.profile.surface.lithic, centerSurface.lithic);
assert.equal(result.profile.surface.shelter, centerSurface.shelter);
assert.equal(result.profile.surface.exposure, centerSurface.exposure);
assert.notEqual(result.profile.surface.heightMeters, conflictingFootprintSample.height);
assert.notEqual(result.profile.surface.moisture, conflictingFootprintSample.moisture);
assert.notEqual(result.profile.surface.slopeDegrees, conflictingFootprintSample.slopeDegrees);

console.log('[checkWorldAssetGeographyPlacementBridge] PASS: geography profiling remains anchored to the canonical center surface and cannot inherit conflicting footprint climate/terrain signals.');
