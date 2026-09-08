import assert from 'node:assert/strict';
import { TERRAIN_ENVIRONMENT_RUNTIME_INTEGRATION_POLICY, resolveTerrainEnvironmentRuntimeRequest, validateTerrainEnvironmentRuntimeRequest, buildRuntimeEnvironmentBatch } from '../src/3d/world/terrainEnvironmentRuntimeIntegration.js';
import { runtimePolicySummary } from '../src/3d/world/terrainEnvironmentRuntimeIntegration.js';

assert.equal(TERRAIN_ENVIRONMENT_RUNTIME_INTEGRATION_POLICY.authoredOnly, true);
assert.equal(TERRAIN_ENVIRONMENT_RUNTIME_INTEGRATION_POLICY.runtimeGeometryCreation, false);
assert.equal(TERRAIN_ENVIRONMENT_RUNTIME_INTEGRATION_POLICY.runtimeMovement, false);
assert.equal(TERRAIN_ENVIRONMENT_RUNTIME_INTEGRATION_POLICY.terrainMutation, false);
assert.equal(TERRAIN_ENVIRONMENT_RUNTIME_INTEGRATION_POLICY.hydrologyMutation, false);
assert.equal(TERRAIN_ENVIRONMENT_RUNTIME_INTEGRATION_POLICY.colliderMutation, false);

const requests = [
  { category: 'tree', sample: { biome: 'forest', climate: 'temperate', slopeDegrees: 11, moisture: 0.58, heightAboveSeaMeters: 120 }, season: 'spring', worldX: -180, worldY: 120, worldZ: 90 },
  { category: 'rock', sample: { biome: 'highland', climate: 'temperate', slopeDegrees: 25, moisture: 0.34, heightAboveSeaMeters: 620, rockExposure: 0.82, talusWeight: 0.45 }, season: 'autumn', worldX: 280, worldY: 620, worldZ: -120 },
  { category: 'cliff', sample: { biome: 'alpine-bare', climate: 'temperate', slopeDegrees: 48, moisture: 0.2, heightAboveSeaMeters: 980, rockExposure: 0.92, talusWeight: 0.76 }, season: 'winter', worldX: 640, worldY: 980, worldZ: 300 },
  { category: 'scree', sample: { biome: 'dryland', climate: 'dryland', slopeDegrees: 31, moisture: 0.08, heightAboveSeaMeters: 340, rockExposure: 0.86, talusWeight: 0.9 }, season: 'summer', worldX: 940, worldY: 340, worldZ: -480 },
];

const resolved = requests.map((request) => resolveTerrainEnvironmentRuntimeRequest(request));
const validations = resolved.map((request) => validateTerrainEnvironmentRuntimeRequest(request, { requireVisible: false }));
assert.equal(resolved.every((request) => request.mutations.geometry === false && request.mutations.terrain === false), true);
assert.equal(resolved.every((request) => request.fingerprint.length === 8), true);
assert.equal(validations.every((validation) => Array.isArray(validation.errors)), true);

const secondPass = requests.map((request) => resolveTerrainEnvironmentRuntimeRequest(request));
assert.deepEqual(resolved.map((request) => request.fingerprint), secondPass.map((request) => request.fingerprint));

const batch = buildRuntimeEnvironmentBatch(resolved);
assert.equal(batch.count, requests.length);
assert.equal(batch.deterministicFingerprints.length, requests.length);
assert.equal(runtimePolicySummary().noTerrainMutation, true);
console.log('[terrain-environment-runtime-depth] PASS', JSON.stringify({ count: batch.count, accepted: batch.acceptedCount, rejected: batch.rejectedCount }));
