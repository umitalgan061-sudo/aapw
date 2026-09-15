import assert from 'node:assert/strict';
import {
  PLAYER_LOCOMOTION_ANTICIPATION_METRICS_VERSION,
  resolvePlayerLocomotionAnticipationMetrics,
  resolvePlayerLocomotionAnticipationQuality,
  resolvePlayerLocomotionAnticipationRiskFlags,
  resolvePlayerLocomotionAnticipationStabilityWindow,
  summarizePlayerLocomotionAnticipationProfiles,
  comparePlayerLocomotionAnticipationMetricRuns,
  createPlayerLocomotionAnticipationMetricController,
  auditPlayerLocomotionAnticipationMetrics,
} from '../src/3d/gameplay/playerLocomotionAnticipationMetrics.js';

function profile(index, overrides = {}) {
  return {
    mode: index % 3 === 0 ? 'cruise' : index % 3 === 1 ? 'brake' : 'pivot',
    speedMps: index % 13,
    speedDeltaMps: (index % 9) - 4,
    accelerationMps2: (index % 17) - 8,
    directionShiftDegrees: (index % 19) * 9 - 81,
    startWeight: (index % 10) / 10,
    brakeWeight: ((index + 3) % 10) / 10,
    pivotWeight: ((index + 5) % 10) / 10,
    confidence: (index % 11) / 10,
    groundRisk: (index % 8) / 7,
    ...overrides,
  };
}

const audit = auditPlayerLocomotionAnticipationMetrics();
assert.equal(audit.version, PLAYER_LOCOMOTION_ANTICIPATION_METRICS_VERSION);
assert.equal(audit.finite, true);
assert.equal(audit.immutable, true);
assert.ok(audit.score >= 0 && audit.score <= 1);

for (let index = 0; index < 512; index += 1) {
  const current = profile(index);
  const previous = profile(index + 1);
  const metrics = resolvePlayerLocomotionAnticipationMetrics(current, previous);
  for (const value of Object.values(metrics)) assert.equal(Number.isFinite(value), true, `metric-${index}`);
  const quality = resolvePlayerLocomotionAnticipationQuality(metrics);
  assert.ok(quality.score >= 0 && quality.score <= 1);
  assert.ok(['A','B','C','D','E'].includes(quality.grade));
  const flags = resolvePlayerLocomotionAnticipationRiskFlags(current);
  assert.ok(Array.isArray(flags));
}

assert.ok(resolvePlayerLocomotionAnticipationRiskFlags(profile(1, { confidence: 0 })).includes('low-confidence'));
assert.ok(resolvePlayerLocomotionAnticipationRiskFlags(profile(2, { groundRisk: 1 })).includes('high-ground-risk'));
assert.ok(resolvePlayerLocomotionAnticipationRiskFlags(profile(3, { accelerationMps2: 50 })).includes('high-acceleration'));
assert.ok(resolvePlayerLocomotionAnticipationRiskFlags(profile(4, { directionShiftDegrees: 170 })).includes('hard-redirect'));
assert.ok(resolvePlayerLocomotionAnticipationRiskFlags(profile(5, { startWeight: 1, brakeWeight: 1 })).includes('competing-intents'));

for (let size = 0; size <= 48; size += 1) {
  const frames = Array.from({ length: size }, (_, index) => ({ speedMps: index % 12, confidence: (index % 10) / 10 }));
  const result = resolvePlayerLocomotionAnticipationStabilityWindow(frames);
  assert.equal(result.samples, size);
  assert.ok(result.score >= 0 && result.score <= 1);
  assert.equal(typeof result.stable, 'boolean');
}

for (let index = 0; index < 64; index += 1) {
  const list = Array.from({ length: index }, (_, entry) => profile(entry));
  const summary = summarizePlayerLocomotionAnticipationProfiles(list);
  assert.equal(summary.count, index);
  assert.ok(summary.meanConfidence >= 0 && summary.meanConfidence <= 1);
  assert.ok(summary.meanGroundRisk >= 0 && summary.meanGroundRisk <= 1);
  assert.ok(summary.pivotRatio >= 0 && summary.pivotRatio <= 1);
  assert.ok(summary.brakeRatio >= 0 && summary.brakeRatio <= 1);
}

const deterministicA = Array.from({ length: 120 }, (_, index) => resolvePlayerLocomotionAnticipationMetrics(profile(index), profile(index + 1)));
const deterministicB = Array.from({ length: 120 }, (_, index) => resolvePlayerLocomotionAnticipationMetrics(profile(index), profile(index + 1)));
assert.equal(comparePlayerLocomotionAnticipationMetricRuns(deterministicA, deterministicB).equal, true);

const controller = createPlayerLocomotionAnticipationMetricController();
for (let index = 0; index < 160; index += 1) {
  const result = controller.update(profile(index), profile(index + 1));
  assert.ok(result.quality.score >= 0 && result.quality.score <= 1);
  assert.ok(result.stability.score >= 0 && result.stability.score <= 1);
}
assert.equal(controller.read().length, 48);
controller.reset();
assert.equal(controller.read().length, 0);

console.log('PLAYER_LOCOMOTION_ANTICIPATION_METRICS_PASS');
