import assert from 'node:assert/strict';
import {
  buildShippedEnvironmentPlan,
  evaluateShippedEnvironmentDelta,
  SHIPPED_ENVIRONMENT_CAMERA_PROFILES,
  SHIPPED_ENVIRONMENT_ACCEPTANCE_TARGETS,
} from '../src/3d/world/shippedEnvironmentVisualOrchestrator.js';

const sample = (overrides = {}) => ({
  id: 'center-near', x: 120, y: 12, z: -44,
  biome: 'temperate-forest', height: 0.42, slope: 14, aspect: 90,
  moisture: 0.72, temperature: 6, waterDistance: 9,
  roadDistance: 48, settlementDistance: 300,
  canonicalHeight: 12, renderedHeight: 12.01, colliderHeight: 12,
  waterCoverage: 0, shorelineGradient: 0.6, skyLuminance: 0.28,
  frameTimeMs: 18, placeholder: false, missingAsset: false,
  materialMismatch: false, floatingAsset: false, interpenetratingAsset: false,
  textureRepeatRisk: 0.08, waterStripeRisk: 0, rectangularWaterRisk: 0,
  seamRisk: 0, blackSkyRisk: 0, forestDensity: 0.42,
  rockExposure: 0.08, snowCoverage: 0, reliefVariance: 0.44,
  ...overrides,
});

const json = (value) => JSON.stringify(value);

const clean = buildShippedEnvironmentPlan({ samples: [sample()] });
const repeat = buildShippedEnvironmentPlan({ samples: [sample()] });
assert.equal(clean.stableDigest, repeat.stableDigest, 'plan must be deterministic');
assert.equal(clean.canonicalAuthorityPreserved, true);
assert.equal(clean.geometryCreated, false);
assert.equal(clean.geographyInvented, false);
assert.equal(clean.editorImported, false);
assert.equal(clean.parityPlan.sameCoordinate, true);
assert.equal(clean.acceptance.pass, true);
assert.equal(clean.reports[0].surface, 'wet-shore');
assert.ok(clean.reports[0].weights.grass >= 0);
assert.ok(clean.reports[0].weights.snow >= 0);
assert.ok(clean.reports[0].weights.rock >= 0);
assert.ok(clean.vegetationPlan.eligibleCount === 1);
assert.ok(clean.waterPlan.length === 1);
assert.ok(clean.atmospherePlan.cameraRelativeSky);
assert.ok(clean.atmospherePlan.weatherReadable);
assert.deepEqual(SHIPPED_ENVIRONMENT_CAMERA_PROFILES.map((item) => item.id), [
  'full-world', 'terrain-far', 'terrain-near-center', 'terrain-near-northwest',
]);
assert.equal(SHIPPED_ENVIRONMENT_ACCEPTANCE_TARGETS.visibleGridSeam, 0);

const p0 = buildShippedEnvironmentPlan({ samples: [sample({
  waterCoverage: 0.9, waterStripeRisk: 0.9, rectangularWaterRisk: 0.9,
  seamRisk: 0.9, blackSkyRisk: 0.9, skyLuminance: 0.01,
})] });
assert.equal(p0.acceptance.pass, false);
assert.ok(p0.acceptance.p0.visibleGridSeam > 0);
assert.ok(p0.acceptance.p0.visibleRectangularWaterBlock > 0);
assert.ok(p0.acceptance.p0.visibleWaterMoire > 0);
assert.ok(p0.acceptance.p0.visibleBlackSky > 0);
assert.ok(p0.waterPlan[0].rotatedMicroCarrier);
assert.ok(p0.waterPlan[0].moireSuppression > 0);

const alpine = buildShippedEnvironmentPlan({ samples: [sample({
  id: 'northwest-near', biome: 'alpine', height: 0.92, slope: 62,
  temperature: -12, snowCoverage: 0.92, rockExposure: 0.06,
  reliefVariance: 0.06, forestDensity: 0.04, waterDistance: 400,
})] });
assert.equal(alpine.reports[0].surface, 'snow-scree');
assert.ok(alpine.reports[0].p1.flatSnowRisk > 0);
assert.ok(alpine.reports[0].p1.missingTalusRisk > 0);
assert.equal(alpine.vegetationPlan.eligibleCount, 0);

const mismatch = buildShippedEnvironmentPlan({ samples: [sample({
  canonicalHeight: 10, renderedHeight: 10.3, colliderHeight: 9.4,
})] });
assert.ok(mismatch.reports[0].p1.heightMismatch > 0);
assert.ok(mismatch.parityPlan.maxRenderedCanonical > 0.2);
assert.ok(mismatch.parityPlan.maxColliderCanonical > 0.5);

const invalid = buildShippedEnvironmentPlan({ samples: [{
  id: 12, slope: 'bad', moisture: NaN, waterDistance: Infinity,
  skyLuminance: undefined, x: NaN, y: Infinity, z: null,
}] });
assert.equal(Number.isFinite(invalid.parityPlan.maxRenderedCanonical), true);
assert.equal(invalid.reports.length, 1);
assert.equal(Object.isFrozen(invalid), true);
assert.equal(Object.isFrozen(invalid.reports[0]), true);
assert.equal(json(invalid), json(buildShippedEnvironmentPlan({ samples: [{
  id: 12, slope: 'bad', moisture: NaN, waterDistance: Infinity,
  skyLuminance: undefined, x: NaN, y: Infinity, z: null,
}] })), 'malformed fallback must serialize stably');

const sorted = buildShippedEnvironmentPlan({ samples: [sample({ id: 'z' }), sample({ id: 'a' })] });
assert.deepEqual(sorted.reports.map((item) => item.id), ['a', 'z']);

const before = { samples: [sample({ rectangularWaterRisk: 0.8, waterStripeRisk: 0.8 })] };
const after = { samples: [sample({ rectangularWaterRisk: 0, waterStripeRisk: 0, forestDensity: 0.3 })] };
const delta = evaluateShippedEnvironmentDelta(before, after);
assert.equal(delta.improved, true);
assert.ok(delta.riskScoreDelta < 0);
assert.equal(delta.beforePass, false);
assert.equal(delta.afterPass, true);
assert.ok(delta.failures.some((item) => item.id === 'hardCoverage'));

const dry = buildShippedEnvironmentPlan({ samples: [sample({
  waterDistance: 80, waterCoverage: 0, shorelineGradient: 0,
  moisture: 0.1, biome: 'dry-steppe', forestDensity: 0,
})] });
assert.equal(dry.waterPlan.length, 0);
assert.equal(dry.acceptance.p4.weakWetEdge || 0, 0);

console.log('checkShippedEnvironmentVisualOrchestrator: PASS');
