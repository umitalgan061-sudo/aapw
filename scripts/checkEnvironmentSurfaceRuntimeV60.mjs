import assert from 'node:assert/strict';
import { createEnvironmentSurfaceRuntimePlan, applyEnvironmentSurfaceRuntimePlan, ENVIRONMENT_SURFACE_RUNTIME_V60 } from '../src/3d/world/environmentSurfaceRuntimeV60.js';

const sample = {
  worldX: 121.25, worldZ: -44.5, seed: 17,
  height01: 0.78, slope01: 0.42, moisture01: 0.66,
  snow01: 0.12, alpine01: 0.18, rockExposure01: 0.24,
  waterCoverage01: 0.08, waterDepth01: 0.14, shoreDistance01: 0.88,
  roadCoverage01: 0, settlementCoverage01: 0, cliff01: 0.12, groundConfidence01: 0.98,
  renderedHeight: 6.04, canonicalHeight: 6, colliderHeight: 6.02,
  backgroundLuminance01: 0.24, horizonReadability01: 0.62, fogDensity01: 0.28,
};

const planA = createEnvironmentSurfaceRuntimePlan(sample);
const planB = createEnvironmentSurfaceRuntimePlan({ ...sample });
assert.equal(planA.version, ENVIRONMENT_SURFACE_RUNTIME_V60);
assert.deepEqual(planA, planB, 'same sample must be deterministic');
assert.ok(planA.surface.weights.grass > 0);
assert.ok(planA.surface.weights.rock >= 0);
assert.equal(planA.contract.sharedAuthority, 'merged-590');
assert.equal(planA.contract.editorImport, false);
assert.equal(planA.contract.geometryCreation, false);
assert.equal(planA.placement.eligible, true);
assert.ok(planA.placement.lod.far === 'impostor');
assert.ok(planA.camera.fullWorld.width === 1536 && planA.camera.fullWorld.height === 1024);
assert.ok(planA.parity.canonicalRenderedDelta > 0);
assert.ok(Object.isFrozen(planA));

const blocked = createEnvironmentSurfaceRuntimePlan({ ...sample, waterCoverage01: 0.95, groundConfidence01: 0.9 });
assert.equal(blocked.placement.eligible, false);
assert.equal(blocked.placement.reason, 'context-exclusion');
assert.equal(blocked.water.suppressCyan, true);

const malformed = createEnvironmentSurfaceRuntimePlan({ worldX: 'bad', worldZ: NaN, slope01: Infinity, height01: null });
assert.ok(Number.isFinite(malformed.surface.microRelief));
assert.ok(Number.isFinite(malformed.atmosphere.exposure));
assert.ok(Number.isFinite(malformed.surface.weights.grass));

const target = {};
assert.equal(applyEnvironmentSurfaceRuntimePlan(target, planA), true);
assert.equal(target.environmentSurfaceRuntime.digest, planA.digest);
assert.equal(applyEnvironmentSurfaceRuntimePlan({}, { version: 'other' }), false);

console.log(`Environment Surface Runtime v60 PASS (${planA.digest})`);
