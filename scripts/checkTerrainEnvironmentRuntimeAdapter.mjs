import assert from 'node:assert/strict';
import { auditEnvironmentRuntimePlan, buildEnvironmentRuntimePlan } from '../src/3d/world/terrainEnvironmentRuntimeAdapter.js';

const input = {
  seed: 'acceptance-seed',
  distanceMeters: 42,
  visibility: 1,
  regions: [
    { centerX: 100, centerZ: -50, radiusMeters: 80, count: 12, context: { biome: 'temperate_forest', moisture: 0.72, elevationMeters: 180, slopeDegrees: 12, waterDepth: 0 } },
    { centerX: -240, centerZ: 310, radiusMeters: 60, count: 8, context: { biome: 'alpine', moisture: 0.35, elevationMeters: 950, slopeDegrees: 28, snowWeight: 0.85, rockWeight: 0.55, waterDepth: 0 } },
  ],
};

const a = buildEnvironmentRuntimePlan(input);
const b = buildEnvironmentRuntimePlan(input);
assert.deepEqual(a, b, 'plan must be deterministic');
assert.equal(a.summary.categories, 5);
assert.ok(a.summary.totalPlanned > 0);
assert.equal(a.attachContract.surfaceAnalysis, 'MaterialAssignmentCore');
assert.equal(a.attachContract.sceneAttach, 'WorldAssetPlacementPipeline');
assert.deepEqual(auditEnvironmentRuntimePlan(a), { ok: true, errors: [] });

const malformed = buildEnvironmentRuntimePlan({ regions: [{ centerX: NaN, centerZ: Infinity, radiusMeters: -1, count: 4, context: { waterDepth: 1 } }] });
assert.ok(malformed.summary.totalPlanned >= 0);
assert.deepEqual(auditEnvironmentRuntimePlan(malformed), { ok: true, errors: [] });
console.log('terrain-environment-runtime-adapter: PASS');
