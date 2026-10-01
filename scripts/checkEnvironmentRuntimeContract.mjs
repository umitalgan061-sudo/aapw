import assert from 'node:assert/strict';
import {
  buildEnvironmentRuntimePlan,
  evaluateEnvironmentRuntimeDelta,
  ENVIRONMENT_RUNTIME_CAMERA_PROFILES,
  ENVIRONMENT_RUNTIME_TARGETS,
} from '../src/3d/world/environmentRuntimeContract.js';

const sample = (overrides = {}) => ({
  id: 'center-near', x: 120, y: 12, z: -44,
  biome: 'temperate-forest', height: 0.42, slope: 14, moisture: 0.72,
  temperature: 6, waterDistance: 9, roadDistance: 48, settlementDistance: 300,
  canonicalHeight: 12, renderedHeight: 12.01, colliderHeight: 12,
  waterCoverage: 0, shorelineGradient: 0.6, skyLuminance: 0.28,
  frameTimeMs: 18, placeholder: false, missingAsset: false,
  materialMismatch: false, floatingAsset: false, interpenetratingAsset: false,
  textureRepeatRisk: 0.08, waterStripeRisk: 0, rectangularWaterRisk: 0,
  seamRisk: 0, blackSkyRisk: 0, forestDensity: 0.42,
  rockExposure: 0.08, snowCoverage: 0, reliefVariance: 0.44,
  waterBodyClass: 'land', reliefClass: 'rolling',
  ...overrides,
});

const clean = buildEnvironmentRuntimePlan({ samples: [sample()] });
const repeat = buildEnvironmentRuntimePlan({ samples: [sample()] });
assert.equal(clean.stableDigest, repeat.stableDigest);
assert.equal(clean.runtimeOwnership.canonicalTerrain, 'caller-owned');
assert.equal(clean.runtimeOwnership.geometryCreated, false);
assert.equal(clean.runtimeOwnership.geographyInvented, false);
assert.equal(clean.runtimeOwnership.editorUiImported, false);
assert.equal(clean.acceptance.pass, true);
assert.equal(clean.reports[0].surface.dominant, 'grass');
assert.equal(clean.vegetationPlans[0].accepted, true);
assert.equal(clean.waterPlans.length, 1);
assert.equal(clean.atmospherePlans[0].cameraRelativeSky, true);
assert.equal(clean.parity.acceptable, true);
assert.deepEqual(ENVIRONMENT_RUNTIME_CAMERA_PROFILES.map((item) => item.id), [
  'full-world', 'terrain-far', 'terrain-near-center', 'terrain-near-northwest',
]);
assert.equal(ENVIRONMENT_RUNTIME_TARGETS.visibleGridSeam, 0);

const waterRisk = buildEnvironmentRuntimePlan({ samples: [sample({
  waterCoverage: 0.9, waterDistance: 0.2, shorelineGradient: 0.9,
  waterStripeRisk: 0.9, rectangularWaterRisk: 0.9, seamRisk: 0.9,
  blackSkyRisk: 0.9, skyLuminance: 0.01,
})] });
assert.equal(waterRisk.acceptance.pass, false);
assert.ok(waterRisk.acceptance.p0.visibleGridSeam > 0);
assert.ok(waterRisk.acceptance.p0.visibleRectangularWaterBlock > 0);
assert.ok(waterRisk.waterPlans[0].rectangularCoverageSuppressed);
assert.ok(waterRisk.waterPlans[0].antiMoire > 0);
assert.equal(waterRisk.vegetationPlans[0].accepted, false);

const alpine = buildEnvironmentRuntimePlan({ samples: [sample({
  id: 'northwest-near', biome: 'alpine', height: 0.92, slope: 62,
  temperature: -12, snowCoverage: 0.92, rockExposure: 0.06,
  reliefVariance: 0.06, forestDensity: 0.04, waterDistance: 400,
})] });
assert.ok(alpine.reports[0].surface.weights.snow > 0.4);
assert.ok(alpine.reports[0].surface.weights.scree > 0.1);
assert.equal(alpine.vegetationPlans[0].accepted, false);

const mismatch = buildEnvironmentRuntimePlan({ samples: [sample({
  canonicalHeight: 10, renderedHeight: 10.3, colliderHeight: 9.4,
})] });
assert.equal(mismatch.parity.acceptable, false);
assert.ok(mismatch.acceptance.p1.parityMismatch > 0);

const invalid = buildEnvironmentRuntimePlan({ samples: [{ id: 12, slope: 'bad', moisture: NaN, waterDistance: Infinity, skyLuminance: undefined, x: NaN, z: null }] });
assert.equal(invalid.reports.length, 1);
assert.equal(Object.isFrozen(invalid), true);
assert.equal(Object.isFrozen(invalid.reports[0]), true);
assert.equal(JSON.stringify(invalid), JSON.stringify(buildEnvironmentRuntimePlan({ samples: [{ id: 12, slope: 'bad', moisture: NaN, waterDistance: Infinity, skyLuminance: undefined, x: NaN, z: null }] })));

const sorted = buildEnvironmentRuntimePlan({ samples: [sample({ id: 'z' }), sample({ id: 'a' })] });
assert.deepEqual(sorted.reports.map((item) => item.id), ['a', 'z']);

const before = { samples: [sample({ rectangularWaterRisk: 0.8, waterStripeRisk: 0.8, forestDensity: 0.02 })] };
const after = { samples: [sample({ rectangularWaterRisk: 0, waterStripeRisk: 0, forestDensity: 0.3 })] };
const delta = evaluateEnvironmentRuntimeDelta(before, after);
assert.equal(delta.improved, true);
assert.ok(delta.riskScoreDelta < 0);

const dry = buildEnvironmentRuntimePlan({ samples: [sample({ biome: 'dry-steppe', moisture: 0.1, waterDistance: 80, waterCoverage: 0, shorelineGradient: 0, forestDensity: 0 })] });
assert.equal(dry.waterPlans.length, 0);
assert.equal(dry.acceptance.p4.weakWetEdge, 0);

console.log('checkEnvironmentRuntimeContract: PASS');
