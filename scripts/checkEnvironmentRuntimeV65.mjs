import assert from 'node:assert/strict';
import { buildAdaptiveDecision, buildAdaptiveRuntimePlan, validateAdaptiveRuntimePlan } from '../src/3d/world/environmentRuntimeAdaptiveV65.js';
import { groundReaction, roleWeights, validateSurfaceResponse } from '../src/3d/world/environmentRuntimeSurfaceV65.js';
import { buildChunkContinuity, continuityMatrix, validateContinuity } from '../src/3d/world/environmentRuntimeContinuityV65.js';
import { buildFrameEnvelope, validateStreamingEnvelope, lodHysteresis } from '../src/3d/world/environmentRuntimeStreamingV65.js';
import { buildPhenologyField, validatePhenology } from '../src/3d/world/environmentRuntimePhenologyV65.js';
import { environmentSnapshot, buildReadOnlyBatch, querySafety, validateSnapshot } from '../src/3d/world/environmentRuntimeQueryV65.js';
import { buildRuntimeReport, validateLedger, V65_OBSERVABILITY_POLICY } from '../src/3d/world/environmentRuntimeObservabilityV65.js';

const failures = [];
const check = (id, fn) => { try { fn(); console.log(`ok:${id}`); } catch (error) { failures.push(`${id}:${error?.stack || error}`); console.error(`fail:${id}`); } };
const sample = (overrides = {}) => ({ x: 120, z: 240, elevation: 420, slope: 8, moisture: 0.62, temperature: 0.34, wind: 0.24, snow: 0.04, waterDistance: 190, roadDistance: 44, settlementDistance: 180, confidence: 0.93, biome: 'forest', ...overrides });

check('adaptive-forest', () => {
  const decision = buildAdaptiveDecision(sample());
  assert.equal(typeof decision.primaryFamily, 'string');
  assert.ok(decision.families.length >= 3);
  assert.ok(decision.density.base > 0);
});

check('adaptive-water-edge', () => {
  const decision = buildAdaptiveDecision(sample({ biome: 'wetland', waterDistance: 24, slope: 3, moisture: 0.94 }));
  assert.ok(['reed', 'riparianTree', 'saltmarsh', 'moss'].includes(decision.primaryFamily));
});

check('adaptive-alpine', () => {
  const decision = buildAdaptiveDecision(sample({ elevation: 1800, slope: 34, temperature: -0.46, snow: 0.72, moisture: 0.28, biome: 'alpine' }));
  assert.ok(decision.families.some((entry) => entry.family === 'alpineRock' || entry.family === 'scree'));
});

check('adaptive-plan', () => {
  const plan = buildAdaptiveRuntimePlan({
    seed: 77,
    samples: [sample(), sample({ x: 180 }), sample({ x: 240, waterDistance: 40, biome: 'wetland' })],
    runtimeInput: { origin: { x: 0, z: 0 }, region: 'north' },
  });
  assert.equal(validateAdaptiveRuntimePlan(plan).ok, true);
});

check('surface-clear', () => {
  const reaction = groundReaction(sample(), { precipitation: 0.06, cloud: 0.2, wind: 0.2, humidity: 0.42, temperature: 0.4, time: 0.5, mode: 'clear' });
  assert.equal(validateSurfaceResponse(reaction).ok, true);
  assert.ok(reaction.luma >= 0.08);
});

check('surface-snow', () => {
  const reaction = groundReaction(sample({ elevation: 1900, snow: 0.9, temperature: -0.5 }), { precipitation: 0.5, humidity: 0.8, temperature: -0.7, time: 0.42, mode: 'snow' });
  assert.ok(reaction.roles.snow > reaction.roles.grass);
  assert.equal(reaction.precipitation, 'snow');
});

check('surface-rain-edge', () => {
  const reaction = groundReaction(sample({ waterDistance: 18, moisture: 0.88 }), { precipitation: 0.8, humidity: 0.94, temperature: 0.12, mode: 'rain' });
  assert.ok(reaction.wetEdge.strength > 0.4);
  assert.equal(validateSurfaceResponse(reaction).ok, true);
});

check('surface-normalization', () => {
  const weights = roleWeights(sample({ slope: 5 }), { precipitation: 0.1, humidity: 0.5, temperature: 0.3 });
  const total = Object.values(weights).reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(total - 1) < 0.015);
});

check('continuity-single', () => {
  const result = buildChunkContinuity({ key: '0:0', anchors: [
    { x: 496, z: 120, family: 'conifer', scale: 1, rotation: 0 },
    { x: 40, z: 40, family: 'grass', scale: 0.8 },
  ] });
  assert.equal(validateContinuity(result).ok, true);
  assert.ok(result.transfers.length >= 1);
});

check('continuity-pair', () => {
  const result = continuityMatrix({
    '0:0': [{ x: 500, z: 180, family: 'conifer', scale: 1 }],
    '1:0': [{ x: 520, z: 182, family: 'conifer', scale: 1.05 }],
  });
  assert.equal(result.pairCount, 1);
  assert.ok(result.meanContinuityRate >= 0);
});

check('streaming-desktop', () => {
  const envelope = buildFrameEnvelope({
    platform: 'desktop',
    metrics: { fps: 57, drawCalls: 140, triangles: 1200000, texturesMb: 720, residentChunks: 7 },
    items: Array.from({ length: 24 }, (_, i) => ({ id: `a${i}`, distance: i * 220, projectedSize: 0.8 - i * 0.02, importance: i < 4 ? 0.8 : 0.4 })),
    camera: { velocity: 18 },
  });
  assert.equal(validateStreamingEnvelope(envelope).ok, true);
  assert.ok(envelope.plan.counts.near > 0);
});

check('streaming-mobile', () => {
  const envelope = buildFrameEnvelope({ platform: 'mobile', metrics: { fps: 31, drawCalls: 88, triangles: 600000, texturesMb: 580, residentChunks: 5 } });
  assert.ok(envelope.budget.factor < 1);
});

check('lod-hysteresis', () => {
  assert.equal(lodHysteresis({ previous: 'mid', next: 'far', distance: 1710, cameraVelocity: 0 }), 'mid');
  assert.equal(lodHysteresis({ previous: 'mid', next: 'far', distance: 2100, cameraVelocity: 0 }), 'far');
});

check('phenology-field', () => {
  const field = buildPhenologyField([
    sample({ biome: 'forest', distance: 120 }),
    sample({ biome: 'taiga', temperature: -0.2, distance: 1600 }),
    sample({ biome: 'grassland', moisture: 0.3, distance: 4000 }),
  ], 280);
  assert.equal(validatePhenology(field).ok, true);
  assert.equal(field.length, 3);
});

check('query-snapshot', () => {
  const snapshot = environmentSnapshot({ sample: sample(), weather: { precipitation: 0.2, cloud: 0.3, humidity: 0.6, temperature: 0.2, mode: 'overcast' }, dayOfYear: 190 });
  assert.equal(validateSnapshot(snapshot).ok, true);
  assert.equal(querySafety(snapshot).ok, true);
});

check('query-batch', () => {
  const batch = buildReadOnlyBatch([sample(), sample({ x: 320, biome: 'grassland' }), sample({ x: 440, water: true, waterDistance: 0 })]);
  assert.equal(batch.snapshots.length, 3);
  assert.match(batch.digest, /^[0-9a-f]{8}$/);
});

check('observability', () => {
  const report = buildRuntimeReport({
    adaptive: { summary: { acceptanceRate: 0.78 } },
    surface: { meanVisibility: 0.82 },
    continuity: { continuityRate: 0.91 },
    streaming: { usage: { max: 0.88 } },
    phenology: { green: 0.52 },
    evidence: [{ readability: 0.94, grounding: 0.92, biomeSeparation: 0.88, waterClarity: 0.9 }],
  });
  assert.equal(report.policy, V65_OBSERVABILITY_POLICY.id);
  assert.equal(validateLedger(report.ledger).ok, true);
  assert.equal(report.ledger.green, true);
});

if (failures.length) {
  console.error(JSON.stringify({ ok: false, failures }, null, 2));
  process.exitCode = 1;
} else {
  console.log(JSON.stringify({ ok: true, suite: 'environment-runtime-v65', checks: 17 }));
}
