import assert from 'node:assert/strict';
import {
  TERRAIN_SNOW_SURFACE_CONTRACT,
  sampleFoldAwareSnowSurface,
  resolveSnowSurfaceMaterial,
  createSnowSurfaceManifest,
} from '../src/3d/world/terrainSnowSurfaceContract.js';

const input = Object.freeze({
  slopeDegrees: 28,
  aspectNorthness: 0.65,
  foldExposure: 0.4,
  shelterPocket: 0.55,
  climateSnowiness: 0.8,
  perturbation: -0.6,
  elevationMeters: 920,
  rockExposure: 0.12,
  cameraDistanceMeters: 180,
  baseSnow: 0.58,
});

const first = sampleFoldAwareSnowSurface(input);
const second = sampleFoldAwareSnowSurface(input);
assert.deepEqual(first, second, 'snow sample must be deterministic');
assert.equal(TERRAIN_SNOW_SURFACE_CONTRACT.mutatesCanonicalHeight, false);
assert.equal(TERRAIN_SNOW_SURFACE_CONTRACT.mutatesHydrology, false);
assert.equal(TERRAIN_SNOW_SURFACE_CONTRACT.mutatesCollider, false);
for (const value of Object.values(first)) assert.ok(Number.isFinite(value));
assert.ok(first.exposure >= 0 && first.exposure <= 1);
assert.ok(first.drift >= 0 && first.drift <= 1);
assert.ok(first.nearFade >= 0 && first.nearFade <= 1);

const near = resolveSnowSurfaceMaterial({ ...input, cameraDistanceMeters: 120 });
const far = resolveSnowSurfaceMaterial({ ...input, cameraDistanceMeters: 8000 });
assert.ok(near.normalGain >= far.normalGain, 'near detail must not be weaker than far detail');
assert.ok(near.roughness >= 0 && near.roughness <= 1.2);
assert.ok(near.albedoGain >= 0.78 && near.albedoGain <= 1.1);

const manifest = createSnowSurfaceManifest(input);
assert.equal(manifest.contract, 1);
assert.equal(manifest.canonicalMutation, false);
assert.equal(manifest.authority, 'canonical-terrain-owner-map');
console.log('Terrain snow surface contract checks passed');
