import assert from 'node:assert/strict';
import {
  PLAYER_RUNTIME_BUDGET_VERSION,
  PLAYER_RUNTIME_BUDGET_LIMITS,
  normalizeRuntimeFrameSamples,
  summarizeRuntimeFrameSamples,
  classifyRuntimeEnvironment,
  estimateSimulationWallRatio,
  estimateWallClockForSimulation,
  calculateVerificationTimeout,
  calculatePollInterval,
  shouldSoftSkipRuntimeAssertion,
  buildRuntimeBudgetDecision,
  compareRuntimeBudgets,
  createRuntimeBudgetReceipt,
  validateRuntimeBudgetDecision,
} from '../src/3d/gameplay/playerRuntimeBudgetPolicy.js';

const normal = [0.016, 0.017, 0.016, 0.018, 0.015, 0.017, 0.016, 0.018];
const constrained = [0.11, 0.12, 0.13, 0.14, 0.12, 0.11, 0.13, 0.12];
const slowSoftware = [3.5, 3.5, 3.5, 8.6];

assert.equal(PLAYER_RUNTIME_BUDGET_VERSION, '2026-09-15-v1');
assert.equal(PLAYER_RUNTIME_BUDGET_LIMITS.minimumSampleCount, 4);
assert.equal(PLAYER_RUNTIME_BUDGET_LIMITS.maximumSampleCount, 240);
assert.ok(PLAYER_RUNTIME_BUDGET_LIMITS.maximumTimeoutMs >= 600000);

const finite = normalizeRuntimeFrameSamples(normal);
assert.equal(finite.length, normal.length);
assert.ok(Object.isFrozen(finite));
assert.ok(finite.every((value) => Number.isFinite(value) && value > 0));

const hostile = normalizeRuntimeFrameSamples([NaN, Infinity, -2, 0, 0.02, 999]);
assert.equal(hostile.length, 6);
assert.ok(hostile.every((value) => value >= PLAYER_RUNTIME_BUDGET_LIMITS.minimumFrameSeconds));
assert.ok(hostile.every((value) => value <= PLAYER_RUNTIME_BUDGET_LIMITS.maximumFrameSeconds));

const emptySummary = summarizeRuntimeFrameSamples([]);
assert.deepEqual(emptySummary, { count: 0, minSeconds: 0, medianSeconds: 0, p95Seconds: 0, maxSeconds: 0, meanSeconds: 0, fps: 0 });

const normalSummary = summarizeRuntimeFrameSamples(normal);
assert.equal(normalSummary.count, 8);
assert.ok(normalSummary.fps > 30);
assert.ok(normalSummary.meanSeconds > 0);
assert.ok(normalSummary.p95Seconds >= normalSummary.medianSeconds);

const constrainedSummary = summarizeRuntimeFrameSamples(constrained);
assert.equal(classifyRuntimeEnvironment(constrainedSummary), 'constrained');
assert.ok(constrainedSummary.fps < 30);
assert.ok(constrainedSummary.fps >= 7);

const slowSummary = summarizeRuntimeFrameSamples(slowSoftware);
assert.equal(classifyRuntimeEnvironment(slowSummary), 'severely-constrained');
assert.ok(slowSummary.maxSeconds > 8);
assert.ok(slowSummary.p95Seconds >= slowSummary.medianSeconds);

assert.equal(classifyRuntimeEnvironment({ fps: 60 }), 'normal');
assert.equal(classifyRuntimeEnvironment({ fps: 30 }), 'normal');
assert.equal(classifyRuntimeEnvironment({ fps: 9 }), 'constrained');
assert.equal(classifyRuntimeEnvironment({ fps: 8 }), 'constrained');
assert.equal(classifyRuntimeEnvironment({ fps: 3 }), 'severely-constrained');
assert.equal(classifyRuntimeEnvironment({ fps: 1 }), 'severely-constrained');
assert.equal(classifyRuntimeEnvironment({ fps: 0 }), 'extremely-constrained');

const normalRatio = estimateSimulationWallRatio(normalSummary);
const constrainedRatio = estimateSimulationWallRatio(constrainedSummary);
const slowRatio = estimateSimulationWallRatio(slowSummary);
assert.ok(normalRatio > constrainedRatio);
assert.ok(constrainedRatio > slowRatio);
assert.ok(normalRatio > 0 && normalRatio <= 1);
assert.ok(slowRatio > 0 && slowRatio <= 1);

const wallNormal = estimateWallClockForSimulation(1, normalSummary);
const wallSlow = estimateWallClockForSimulation(1, slowSummary);
assert.ok(wallNormal < wallSlow);
assert.ok(wallNormal > 0);
assert.ok(wallSlow > wallNormal);

const normalTimeout = calculateVerificationTimeout(1, normalSummary);
const slowTimeout = calculateVerificationTimeout(1, slowSummary);
assert.ok(normalTimeout >= PLAYER_RUNTIME_BUDGET_LIMITS.minimumTimeoutMs);
assert.ok(slowTimeout >= normalTimeout);
assert.ok(slowTimeout <= PLAYER_RUNTIME_BUDGET_LIMITS.maximumTimeoutMs);

const constrainedTimeout = calculateVerificationTimeout(2, constrainedSummary, { extraMultiplier: 1.2 });
const constrainedTimeoutDefault = calculateVerificationTimeout(2, constrainedSummary);
assert.ok(constrainedTimeout >= constrainedTimeoutDefault);
assert.ok(constrainedTimeout <= PLAYER_RUNTIME_BUDGET_LIMITS.maximumTimeoutMs);

assert.ok(calculatePollInterval(normalSummary) < calculatePollInterval(slowSummary));
assert.ok(calculatePollInterval(slowSummary) <= PLAYER_RUNTIME_BUDGET_LIMITS.maximumPollIntervalMs);
assert.ok(calculatePollInterval({ meanSeconds: Infinity }) <= PLAYER_RUNTIME_BUDGET_LIMITS.maximumPollIntervalMs);

assert.equal(shouldSoftSkipRuntimeAssertion(normalSummary), false);
assert.equal(shouldSoftSkipRuntimeAssertion({ count: 3, fps: 60 }), true);
assert.equal(shouldSoftSkipRuntimeAssertion({ count: 8, fps: 0.25 }), true);
assert.equal(shouldSoftSkipRuntimeAssertion({ count: 8, fps: 0.75 }), false);

const normalDecision = buildRuntimeBudgetDecision(normal, { simulationSeconds: 1 });
assert.equal(normalDecision.version, PLAYER_RUNTIME_BUDGET_VERSION);
assert.equal(normalDecision.classification, 'normal');
assert.equal(normalDecision.softSkip, false);
assert.equal(normalDecision.probeReady, true);
assert.ok(normalDecision.timeoutMs >= 5000);
assert.ok(normalDecision.timeoutMs <= 900000);
assert.ok(Number.isFinite(normalDecision.simulationWallRatio));
assert.ok(normalDecision.reason.includes('standard verification'));
assert.ok(Object.isFrozen(normalDecision));
assert.ok(Object.isFrozen(normalDecision.summary));

const slowDecision = buildRuntimeBudgetDecision(slowSoftware, { simulationSeconds: 1 });
assert.equal(slowDecision.classification, 'severely-constrained');
assert.equal(slowDecision.softSkip, false);
assert.ok(slowDecision.timeoutMs > normalDecision.timeoutMs);
assert.ok(slowDecision.reason.includes('derived timeout'));

const shortDecision = buildRuntimeBudgetDecision([0.016, 0.017], { simulationSeconds: 1 });
assert.equal(shortDecision.probeReady, false);
assert.equal(shortDecision.softSkip, true);
assert.equal(shortDecision.summary.count, 2);

const repeated = buildRuntimeBudgetDecision(normal, { simulationSeconds: 1 });
assert.deepEqual(normalDecision, repeated);

const comparison = compareRuntimeBudgets({ samples: normal, simulationSeconds: 1 }, { samples: slowSoftware, simulationSeconds: 1 });
assert.equal(comparison.moreConstrained, true);
assert.ok(comparison.timeoutDeltaMs > 0);
assert.ok(comparison.fpsDelta < 0);
assert.equal(comparison.left.classification, 'normal');
assert.equal(comparison.right.classification, 'severely-constrained');

const receipt = createRuntimeBudgetReceipt(slowSoftware, { simulationSeconds: 1 });
assert.equal(receipt.version, PLAYER_RUNTIME_BUDGET_VERSION);
assert.equal(receipt.classification, 'severely-constrained');
assert.equal(receipt.sampleCount, 4);
assert.ok(receipt.evidence.p95FrameSeconds >= receipt.evidence.medianFrameSeconds);
assert.ok(Object.isFrozen(receipt));
assert.ok(Object.isFrozen(receipt.evidence));

const valid = validateRuntimeBudgetDecision(slowDecision);
assert.equal(valid.valid, true);
assert.deepEqual(valid.errors, []);

const invalidVersion = validateRuntimeBudgetDecision({ ...slowDecision, version: 'wrong' });
assert.equal(invalidVersion.valid, false);
assert.ok(invalidVersion.errors.includes('version'));

const invalidTimeout = validateRuntimeBudgetDecision({ ...slowDecision, timeoutMs: 2 });
assert.equal(invalidTimeout.valid, false);
assert.ok(invalidTimeout.errors.includes('timeoutMs'));

const invalidRatio = validateRuntimeBudgetDecision({ ...slowDecision, simulationWallRatio: 2 });
assert.equal(invalidRatio.valid, false);
assert.ok(invalidRatio.errors.includes('simulationWallRatio'));

for (const samples of [normal, constrained, slowSoftware, [0.001, 0.5, 1, 2], [Infinity, NaN, 0.1, 0.2]]) {
  const decision = buildRuntimeBudgetDecision(samples, { simulationSeconds: 0.5 });
  assert.ok(decision.timeoutMs >= PLAYER_RUNTIME_BUDGET_LIMITS.minimumTimeoutMs);
  assert.ok(decision.timeoutMs <= PLAYER_RUNTIME_BUDGET_LIMITS.maximumTimeoutMs);
  assert.ok(decision.pollIntervalMs >= 25);
  assert.ok(decision.pollIntervalMs <= PLAYER_RUNTIME_BUDGET_LIMITS.maximumPollIntervalMs);
  assert.ok(decision.summary.count >= 0);
}

console.log('player runtime budget policy regression: PASS');
