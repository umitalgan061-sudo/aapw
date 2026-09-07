import assert from 'node:assert/strict';
import {
  TERRAIN_SURFACE_ANTI_TILING_POLICY,
  TERRAIN_SURFACE_ANTI_TILING_MANIFEST,
  terrainSurfaceAntiTilingAt,
  buildTerrainSurfaceMaterialInputs,
  terrainSurfaceAntiTilingFingerprint,
  validateTerrainSurfaceAntiTilingResponse,
} from '../src/3d/world/terrainSurfaceAntiTiling.js';

const context = {
  seed: 20260907,
  elevationMeters: 112,
  slopeDegrees: 24,
  moisture: 0.42,
  rockWeight: 0.31,
  snowWeight: 0.08,
  waterWeight: 0,
  waterDistanceMeters: 190,
};

const first = terrainSurfaceAntiTilingAt(740, -1280, context);
const second = terrainSurfaceAntiTilingAt(740, -1280, context);
assert.deepEqual(first, second, 'anti-tiling response must be deterministic');
assert.equal(validateTerrainSurfaceAntiTilingResponse(first).ok, true);
assert.equal(first.worldSpace, true);
assert.equal(first.canonicalContextPreserved, true);
assert.ok(first.antiTile >= 0 && first.antiTile <= 1);
assert.ok(first.albedoVariation <= TERRAIN_SURFACE_ANTI_TILING_POLICY.maxAlbedoGain);
assert.ok(first.roughnessVariation <= TERRAIN_SURFACE_ANTI_TILING_POLICY.maxRoughnessGain);
assert.ok(first.normalVariation <= TERRAIN_SURFACE_ANTI_TILING_POLICY.maxNormalGain);
assert.equal(terrainSurfaceAntiTilingFingerprint(740, -1280, context), terrainSurfaceAntiTilingFingerprint(740, -1280, context));

const far = buildTerrainSurfaceMaterialInputs(6000, 6000, context);
assert.ok(far.colorGain <= first.albedoVariation + 1e-9, 'far fade must not amplify breakup');

const shoreline = terrainSurfaceAntiTilingAt(740, -1280, { ...context, waterDistanceMeters: 0.1, waterWeight: 0.8 });
assert.ok(shoreline.antiTile <= first.antiTile + 1e-9, 'shoreline halo must suppress dry anti-tiling response');

assert.equal(TERRAIN_SURFACE_ANTI_TILING_MANIFEST.policyId, TERRAIN_SURFACE_ANTI_TILING_POLICY.id);
assert.equal(TERRAIN_SURFACE_ANTI_TILING_POLICY.canonicalHeightUnchanged, true);
assert.equal(TERRAIN_SURFACE_ANTI_TILING_POLICY.canonicalHydrologyUnchanged, true);
assert.equal(TERRAIN_SURFACE_ANTI_TILING_POLICY.canonicalColliderUnchanged, true);
console.log('TERRAIN_SURFACE_ANTI_TILING_PASS');
