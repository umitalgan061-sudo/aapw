import assert from 'node:assert/strict';
import {
  TERRAIN_SURFACE_RUNTIME_BRIDGE_MANIFEST,
  applyTerrainSurfaceAntiTilingRuntimeBridge,
  validateTerrainSurfaceAntiTilingRuntimeBridgeResult,
} from '../src/3d/world/terrainSurfaceAntiTilingRuntimeBridge.js';

const context = {
  seed: 20260908,
  elevationMeters: 180,
  slopeDegrees: 19,
  moisture: 0.44,
  rockWeight: 0.28,
  snowWeight: 0.12,
  waterWeight: 0,
  waterDistanceMeters: 96,
};

const material = { uniforms: {} };
const first = applyTerrainSurfaceAntiTilingRuntimeBridge(material, 1260, -840, context);
assert.equal(validateTerrainSurfaceAntiTilingRuntimeBridgeResult(first).ok, true);
assert.equal(first.applied, true);
assert.equal(first.response.policyId.length > 0, true);
assert.equal(material.userData.terrainSurfaceAudit.canonicalContextPreserved, true);
for (const key of [
  'uTerrainColorGain',
  'uTerrainRoughnessGain',
  'uTerrainNormalGain',
  'uTerrainSoilWeight',
  'uTerrainRockWeight',
  'uTerrainSnowWeight',
  'uTerrainWetWeight',
]) assert.equal(typeof material.uniforms[key].value, 'number');

const secondMaterial = { uniforms: {} };
const second = applyTerrainSurfaceAntiTilingRuntimeBridge(secondMaterial, 1260, -840, context);
assert.deepEqual(first.response, second.response, 'bridge inputs must be deterministic');
assert.deepEqual(material.uniforms, secondMaterial.uniforms, 'uniform payload must be deterministic');
assert.equal(TERRAIN_SURFACE_RUNTIME_BRIDGE_MANIFEST.forbiddenScope.includes('geometry'), true);

const invalid = applyTerrainSurfaceAntiTilingRuntimeBridge(null, NaN, Infinity, { slopeDegrees: NaN });
assert.equal(invalid.response.worldX, 0);
assert.equal(invalid.response.worldZ, 0);
assert.equal(invalid.applied, true, 'malformed context must fail safe without blocking material defaults');
console.log('TERRAIN_SURFACE_ANTI_TILING_RUNTIME_BRIDGE_PASS');
