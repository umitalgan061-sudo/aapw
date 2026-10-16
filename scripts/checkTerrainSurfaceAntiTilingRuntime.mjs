import assert from 'node:assert/strict';
import {
	terrainSurfaceRuntimeInputs,
	validateTerrainSurfaceRuntimeInputs,
	TERRAIN_SURFACE_RUNTIME_MANIFEST,
} from '../src/3d/world/terrainSurfaceAntiTilingRuntime.js';

const context = {
	cameraX: 0,
	cameraZ: 0,
	seed: 283,
	elevationMeters: 220,
	slopeDegrees: 17,
	moisture: 0.42,
	rockWeight: 0.18,
	snowWeight: 0.08,
	waterWeight: 0,
	waterDistanceMeters: 140,
};

const near = terrainSurfaceRuntimeInputs(80, -60, context);
const far = terrainSurfaceRuntimeInputs(3900, 0, context);
const nearAgain = terrainSurfaceRuntimeInputs(80, -60, context);

assert.equal(near.policyId, TERRAIN_SURFACE_RUNTIME_MANIFEST.policyId);
assert.equal(validateTerrainSurfaceRuntimeInputs(near).ok, true);
assert.equal(validateTerrainSurfaceRuntimeInputs(far).ok, true);
assert.deepEqual(near, nearAgain, 'runtime response must be deterministic');
assert.ok(near.cameraFade > far.cameraFade, 'camera-relative fade must reduce distant detail');
assert.ok(near.colorGain >= 0 && near.colorGain <= 0.13, 'albedo gain must remain bounded');
assert.ok(near.roughnessGain >= 0 && near.roughnessGain <= 0.18, 'roughness gain must remain bounded');
assert.ok(near.normalGain >= 0 && near.normalGain <= 0.21, 'normal gain must remain bounded');
assert.equal(near.canonicalContextPreserved, true);

console.log('TERRAIN_SURFACE_ANTI_TILING_RUNTIME_PASS');
