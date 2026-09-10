import assert from 'node:assert/strict';
import {
  buildEnvironmentRuntimeAdoptionV58,
  applyEnvironmentRuntimeAdoptionV58,
  stableEnvironmentRuntimeDigestV58,
  ENVIRONMENT_RUNTIME_ADOPTION_V58_ID,
} from '../src/3d/world/environmentRuntimeAdoptionV58.js';

const samples = [
  { x: 0, y: 12, z: 0, canonicalHeight: 12, renderedHeight: 12.02, colliderHeight: 12.01, slope: 0.12, moisture: 0.8, waterDistance: 40, biome: 'forest', surface: 'grass', assetReady: true },
  { x: 90, y: 48, z: -20, canonicalHeight: 48, renderedHeight: 48.01, colliderHeight: 48.02, slope: 0.88, moisture: 0.4, snow: 0.8, biome: 'alpine', surface: 'cliff', steep: true, assetReady: true },
  { x: -60, y: 2, z: 35, canonicalHeight: 2, renderedHeight: 2, colliderHeight: 2, slope: 0.04, moisture: 0.95, waterDepth: 2.4, waterDistance: 1, biome: 'coast', surface: 'shore', assetReady: true },
];

const planA = buildEnvironmentRuntimeAdoptionV58({ samples, cameraDistance: 42 });
const planB = buildEnvironmentRuntimeAdoptionV58({ samples, cameraDistance: 42 });
assert.equal(planA.id, ENVIRONMENT_RUNTIME_ADOPTION_V58_ID);
assert.equal(planA.camera.width, 1536);
assert.equal(planA.camera.height, 1024);
assert.equal(planA.camera.orthographic, true);
assert.equal(stableEnvironmentRuntimeDigestV58(planA), stableEnvironmentRuntimeDigestV58(planB));
assert.equal(Object.isFrozen(planA), true);
assert.equal(Object.isFrozen(planA.plans[0]), true);
assert.equal(planA.summary.sampleCount, 3);
assert.equal(planA.plans[1].vegetation.eligible, false);
assert.equal(planA.plans[2].water.antiMoire, true);
assert.equal(planA.plans[2].water.linePatternSuppression, true);
assert.equal(planA.plans[0].materials.worldSpaceAntiTiling, true);
assert.equal(planA.plans[0].materials.triplanarOrEquivalent, true);
assert.equal(planA.sharedContract.editorRuntimeImport, false);
assert.equal(planA.sharedContract.geometryCreation, false);
assert.equal(planA.sharedContract.canonicalMutation, false);

const target = {};
const applied = applyEnvironmentRuntimeAdoptionV58(target, planA);
assert.equal(applied.applied, true);
assert.equal(target.environmentRuntimeAdoptionV58.id, ENVIRONMENT_RUNTIME_ADOPTION_V58_ID);
assert.equal(applyEnvironmentRuntimeAdoptionV58(null, planA).reason, 'missing-target');
assert.equal(applyEnvironmentRuntimeAdoptionV58({}, null).reason, 'missing-plan');

const malformed = buildEnvironmentRuntimeAdoptionV58({ samples: [{ x: NaN, y: Infinity, slope: 'bad', moisture: null, cameraDistance: -4 }] });
assert.equal(Number.isFinite(malformed.plans[0].coordinate.x), true);
assert.equal(Number.isFinite(malformed.plans[0].materials.repeatScale), true);
assert.equal(malformed.plans[0].parity.pass, true);

const reordered = buildEnvironmentRuntimeAdoptionV58({ samples: [...samples].reverse(), cameraDistance: 42 });
assert.notEqual(stableEnvironmentRuntimeDigestV58(planA), stableEnvironmentRuntimeDigestV58(reordered));
console.log(`environment-runtime-adoption-v58: PASS (${planA.summary.sampleCount} samples)`);
