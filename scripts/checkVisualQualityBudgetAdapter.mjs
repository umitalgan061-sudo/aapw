import assert from 'node:assert/strict';
import {
  applyVisualQualityBudgetHints,
  evaluateVisualQualityBudget,
  serializeVisualQualityBudget,
} from '../src/3d/world/visualQualityBudgetAdapter.js';

const clean = {
  fogVisibility: 2400,
  drawCalls: 120,
  triangles: 180000,
  frameMs: 14,
  textureMb: 96,
  seamRisk: 0,
  waterArtifactRisk: 0,
  blackSkyRisk: 0,
  placeholderRisk: 0,
  groundedRisk: 0,
  detailEnergy: 0.9,
  daylight: 0.7,
};

const first = evaluateVisualQualityBudget(clean);
const second = evaluateVisualQualityBudget({ ...clean });
assert.deepEqual(first, second);
assert.equal(first.tier, 'full');
assert.equal(first.acceptance.visibleSeam, true);
assert.equal(first.acceptance.visibleRectangularWater, true);
assert.equal(first.acceptance.withinMobileBudget, true);

const p0 = evaluateVisualQualityBudget({ ...clean, waterArtifactRisk: 0.9 });
assert.equal(p0.tier, 'reject');
assert.equal(p0.acceptance.visibleRectangularWater, false);
assert.equal(p0.hints.waterMicroScale, 0.35);

const perf = evaluateVisualQualityBudget({ ...clean, frameMs: 42, detailEnergy: 0.2 });
assert.equal(perf.tier, 'degrade');
assert.equal(perf.hints.shouldSuppressFarMicro, true);
assert.equal(perf.hints.normalEnergy, 0.48);

const target = { farMicroEnabled: true, normalEnergy: 1, vegetationDensityScale: 1, waterMicroScale: 1, blackSkyGuardEnabled: false };
const applied = applyVisualQualityBudgetHints(target, { ...clean, blackSkyRisk: 0.5 });
assert.equal(applied.tier, 'reject');
assert.equal(target.farMicroEnabled, false);
assert.equal(target.blackSkyGuardEnabled, true);

const malformed = evaluateVisualQualityBudget({ drawCalls: 'oops', frameMs: NaN, seamRisk: Infinity });
for (const value of Object.values(malformed.sample)) assert.equal(Number.isFinite(value), true);
assert.equal(serializeVisualQualityBudget(clean), serializeVisualQualityBudget({ ...clean }));

console.log(JSON.stringify({
  deterministic: true,
  cleanTier: first.tier,
  p0Tier: p0.tier,
  perfTier: perf.tier,
  malformedFinite: true,
  stableKey: first.deterministicKey,
}));
