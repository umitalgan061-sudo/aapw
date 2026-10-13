import assert from 'node:assert/strict';
import { createEnvironmentVisualAdoption, applyEnvironmentVisualAdoption, serializeEnvironmentVisualAdoption } from '../src/3d/world/environmentVisualAdoptionContract.js';

const base = {
  worldX: 812.25,
  worldZ: -193.5,
  seed: 283,
  cameraDistance: 24,
  sample: {
    slope: 0.28,
    moisture: 0.42,
    elevation: 0.36,
    snow: 0.02,
    permanentSnow: 0,
    waterDistance: 180,
    waterDepth: 0,
    waterBody: false,
    groundConfidence: 1,
    roadInfluence: 0.05,
    settlementInfluence: 0.12,
  },
};

const a = createEnvironmentVisualAdoption(base);
const b = createEnvironmentVisualAdoption(base);
assert.deepEqual(a, b, 'same world sample must be deterministic');
assert.equal(a.accepted, true);
assert.equal(a.excluded, false);
assert.equal(a.canonical.terrainHeightUnchanged, true);
assert.equal(a.canonical.hydrologyUnchanged, true);
assert.equal(a.adoption.requiresMaterialAssignmentCore, true);
assert.equal(a.adoption.requiresWorldAssetPlacementPipeline, true);
assert.equal(a.adoption.editorRuntimeImport, false);

const weights = a.surfaceWeights;
for (const key of ['grass', 'soil', 'mud', 'sand', 'rock', 'scree', 'snow', 'wetEdge']) {
  assert.ok(Number.isFinite(weights[key]), `${key} must be finite`);
  assert.ok(weights[key] >= 0 && weights[key] <= 1, `${key} must be bounded`);
}
const total = ['grass', 'soil', 'mud', 'sand', 'rock', 'scree', 'snow', 'wetEdge'].reduce((sum, key) => sum + weights[key], 0);
assert.ok(Math.abs(total - 1) < 1e-9, 'surface weights must normalize');

const alpine = createEnvironmentVisualAdoption({
  ...base,
  worldX: 100,
  sample: { ...base.sample, slope: 0.9, elevation: 0.95, snow: 0.9, permanentSnow: 0.9 },
});
assert.equal(alpine.accepted, false);
assert.ok(alpine.exclusionReasons.includes('steep-slope'));
assert.ok(alpine.exclusionReasons.includes('permanent-snow'));
assert.ok(alpine.surfaceWeights.scree > alpine.surfaceWeights.grass);

const shoreline = createEnvironmentVisualAdoption({
  ...base,
  sample: { ...base.sample, waterDistance: 3, moisture: 0.85 },
});
assert.ok(shoreline.surfaceWeights.wetEdge > a.surfaceWeights.wetEdge);
assert.ok(shoreline.modifiers.wetEdgeFoam > 0);

const water = createEnvironmentVisualAdoption({
  ...base,
  sample: { ...base.sample, waterBody: true, waterDepth: 4 },
});
assert.equal(water.accepted, false);
assert.ok(water.exclusionReasons.includes('canonical-water'));

const malformed = createEnvironmentVisualAdoption({
  worldX: Number.NaN,
  worldZ: Number.POSITIVE_INFINITY,
  cameraDistance: Number.NaN,
  sample: { slope: Number.NaN, moisture: Number.NaN, groundConfidence: Number.NaN },
});
assert.doesNotThrow(() => JSON.stringify(malformed));
assert.ok(Number.isFinite(malformed.modifiers.normalEnergy));
assert.equal(serializeEnvironmentVisualAdoption(a), serializeEnvironmentVisualAdoption(b));

const material = { roughness: 0.7, metalness: 0.5, normalScale: { set(x, y) { this.x = x; this.y = y; } } };
const target = { material, userData: { existing: true } };
assert.equal(applyEnvironmentVisualAdoption(target, a), true);
assert.ok(target.material.normalScale.x > 0);
assert.equal(target.userData.existing, true);
assert.equal(target.userData.environmentVisualAdoption.contract, 'environment-visual-adoption-v20');

console.log('Environment visual adoption contract: PASS');
