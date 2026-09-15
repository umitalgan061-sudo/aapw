import assert from 'node:assert/strict';
import {
  PLAYER_RUNTIME_ASSERTION_PLAN_VERSION,
  PLAYER_RUNTIME_ASSERTION_SCENARIOS,
  normalizeAssertionScenario,
  buildAssertionScenarioIntent,
  calculateScenarioWallBudget,
  buildAssertionPlan,
  buildAllAssertionPlans,
  summarizeAssertionPlans,
  validateAssertionPlan,
  buildScenarioEvidence,
  compareAssertionPlans,
  replayAssertionPlan,
  buildEnvironmentAwareExecutionSummary,
} from '../src/3d/gameplay/playerRuntimeAssertionPlan.js';

const normal = [0.016, 0.017, 0.016, 0.018, 0.015, 0.017, 0.016, 0.018];
const constrained = [0.11, 0.12, 0.13, 0.14, 0.12, 0.11, 0.13, 0.12];
const software = [3.5, 3.5, 3.5, 8.6];
const sparse = [0.016, 0.018];

assert.equal(PLAYER_RUNTIME_ASSERTION_PLAN_VERSION, '2026-09-15-v1');
assert.equal(Object.keys(PLAYER_RUNTIME_ASSERTION_SCENARIOS).length, 6);
assert.deepEqual(Object.keys(PLAYER_RUNTIME_ASSERTION_SCENARIOS), [
  'stamina-dodge', 'dodge-iframe', 'guard-impact', 'melee-combo', 'hit-stagger', 'parry-recovery',
]);

assert.equal(normalizeAssertionScenario('stamina-dodge'), 'stamina-dodge');
assert.equal(normalizeAssertionScenario('DODGE-IFRAME'), 'dodge-iframe');
assert.equal(normalizeAssertionScenario('unknown'), 'stamina-dodge');
assert.equal(normalizeAssertionScenario(null), 'stamina-dodge');
assert.equal(normalizeAssertionScenario(''), 'stamina-dodge');

for (const scenario of Object.keys(PLAYER_RUNTIME_ASSERTION_SCENARIOS)) {
  const intent = buildAssertionScenarioIntent(scenario);
  assert.equal(intent.scenario, scenario);
  assert.ok(intent.simulationSeconds > 0);
  assert.ok(intent.actionWindowSeconds >= 0);
  assert.ok(intent.warmupSeconds >= 0);
  assert.equal(intent.minimumFps, 0.5);
  assert.ok(Object.isFrozen(intent));
}

const hostileIntent = buildAssertionScenarioIntent('melee-combo', {
  simulationSeconds: Infinity,
  minimumFps: NaN,
  actionWindowSeconds: -5,
  warmupSeconds: 999,
});
assert.equal(hostileIntent.simulationSeconds, 10);
assert.equal(hostileIntent.minimumFps, 0.1);
assert.equal(hostileIntent.actionWindowSeconds, 0);
assert.equal(hostileIntent.warmupSeconds, 10);

for (const scenario of Object.keys(PLAYER_RUNTIME_ASSERTION_SCENARIOS)) {
  const wallBudget = calculateScenarioWallBudget(scenario, normal);
  assert.equal(wallBudget.scenario, scenario);
  assert.ok(wallBudget.totalWallMs >= 5000);
  assert.ok(wallBudget.assertionTimeoutMs >= 5000);
  assert.ok(wallBudget.pollIntervalMs >= 25);
  assert.ok(wallBudget.pollIntervalMs <= 500);
  assert.ok(wallBudget.budget.timeoutMs === wallBudget.assertionTimeoutMs);
}

const normalStamina = buildAssertionPlan('stamina-dodge', normal);
assert.equal(normalStamina.version, PLAYER_RUNTIME_ASSERTION_PLAN_VERSION);
assert.equal(normalStamina.status, 'runnable');
assert.equal(normalStamina.reliable, true);
assert.equal(normalStamina.executeAssertions, true);
assert.equal(normalStamina.classification, 'normal');
assert.ok(normalStamina.timing.simulationSeconds > 0);
assert.ok(normalStamina.timing.totalWallMs >= 5000);
assert.ok(Object.isFrozen(normalStamina));

const constrainedStamina = buildAssertionPlan('stamina-dodge', constrained);
assert.equal(constrainedStamina.status, 'runnable-constrained');
assert.equal(constrainedStamina.reliable, true);
assert.equal(constrainedStamina.executeAssertions, true);
assert.ok(constrainedStamina.timeoutMs > normalStamina.timeoutMs);
assert.equal(constrainedStamina.classification, 'constrained');

const softwareMelee = buildAssertionPlan('melee-combo', software);
assert.equal(softwareMelee.status, 'runnable-constrained');
assert.equal(softwareMelee.reliable, true);
assert.equal(softwareMelee.executeAssertions, true);
assert.equal(softwareMelee.classification, 'severely-constrained');
assert.ok(softwareMelee.timeoutMs > constrainedStamina.timeoutMs);
assert.ok(softwareMelee.timing.totalWallMs > normalStamina.timing.totalWallMs);

const sparseParry = buildAssertionPlan('parry-recovery', sparse);
assert.equal(sparseParry.status, 'inconclusive');
assert.equal(sparseParry.reliable, false);
assert.equal(sparseParry.executeAssertions, false);
assert.equal(sparseParry.classification, 'normal');

const allNormal = buildAllAssertionPlans(normal);
assert.equal(allNormal.length, 6);
assert.ok(allNormal.every((plan) => plan.status === 'runnable'));
assert.ok(allNormal.every((plan) => plan.executeAssertions));

const allSoftware = buildAllAssertionPlans(software);
assert.equal(allSoftware.length, 6);
assert.ok(allSoftware.every((plan) => plan.status === 'runnable-constrained'));
assert.ok(allSoftware.every((plan) => plan.executeAssertions));

const allSparse = buildAllAssertionPlans(sparse);
assert.equal(allSparse.length, 6);
assert.ok(allSparse.every((plan) => plan.status === 'inconclusive'));
assert.ok(allSparse.every((plan) => !plan.executeAssertions));

const normalSummary = summarizeAssertionPlans(allNormal);
assert.equal(normalSummary.count, 6);
assert.equal(normalSummary.runnableCount, 6);
assert.equal(normalSummary.inconclusiveCount, 0);
assert.equal(normalSummary.constrainedCount, 0);
assert.equal(normalSummary.allReliable, true);
assert.ok(normalSummary.maximumTimeoutMs > 0);

const softwareSummary = summarizeAssertionPlans(allSoftware);
assert.equal(softwareSummary.count, 6);
assert.equal(softwareSummary.runnableCount, 6);
assert.equal(softwareSummary.inconclusiveCount, 0);
assert.equal(softwareSummary.constrainedCount, 6);
assert.equal(softwareSummary.allReliable, true);

const sparseSummary = summarizeAssertionPlans(allSparse);
assert.equal(sparseSummary.count, 6);
assert.equal(sparseSummary.runnableCount, 0);
assert.equal(sparseSummary.inconclusiveCount, 6);
assert.equal(sparseSummary.constrainedCount, 0);
assert.equal(sparseSummary.allReliable, false);

const validPlan = validateAssertionPlan(normalStamina);
assert.equal(validPlan.valid, true);
assert.deepEqual(validPlan.errors, []);

const invalidScenario = validateAssertionPlan({ ...normalStamina, scenario: 'made-up' });
assert.equal(invalidScenario.valid, false);
assert.ok(invalidScenario.errors.includes('scenario'));

const invalidStatus = validateAssertionPlan({ ...normalStamina, status: 'pass' });
assert.equal(invalidStatus.valid, false);
assert.ok(invalidStatus.errors.includes('status'));

const invalidTimeout = validateAssertionPlan({ ...normalStamina, timeoutMs: 1 });
assert.equal(invalidTimeout.valid, false);
assert.ok(invalidTimeout.errors.includes('timeoutMs'));

const invalidPoll = validateAssertionPlan({ ...normalStamina, pollIntervalMs: 1 });
assert.equal(invalidPoll.valid, false);
assert.ok(invalidPoll.errors.includes('pollIntervalMs'));

const invalidTiming = validateAssertionPlan({ ...normalStamina, timing: null });
assert.equal(invalidTiming.valid, false);
assert.ok(invalidTiming.errors.includes('timing'));

const normalEvidence = buildScenarioEvidence(normalStamina);
assert.equal(normalEvidence.valid, true);
assert.equal(normalEvidence.scenario, 'stamina-dodge');
assert.equal(normalEvidence.status, 'runnable');
assert.equal(normalEvidence.reliable, true);
assert.equal(normalEvidence.executeAssertions, true);
assert.equal(normalEvidence.timeoutMs, normalStamina.timeoutMs);
assert.equal(normalEvidence.simulationSeconds, normalStamina.timing.simulationSeconds);
assert.ok(Object.isFrozen(normalEvidence));

const sparseEvidence = buildScenarioEvidence(sparseParry);
assert.equal(sparseEvidence.valid, true);
assert.equal(sparseEvidence.status, 'inconclusive');
assert.equal(sparseEvidence.reliable, false);
assert.equal(sparseEvidence.executeAssertions, false);

const planComparison = compareAssertionPlans(normalStamina, constrainedStamina);
assert.equal(planComparison.sameScenario, true);
assert.equal(planComparison.statusChanged, true);
assert.equal(planComparison.classificationChanged, true);
assert.equal(planComparison.reliableChanged, false);
assert.equal(planComparison.executeChanged, false);
assert.ok(planComparison.timeoutDeltaMs > 0);

const planRecovery = compareAssertionPlans(constrainedStamina, normalStamina);
assert.ok(planRecovery.timeoutDeltaMs < 0);
assert.ok(planRecovery.pollDeltaMs !== undefined);

const samePlan = compareAssertionPlans(normalStamina, buildAssertionPlan('stamina-dodge', normal));
assert.equal(samePlan.sameScenario, true);
assert.equal(samePlan.statusChanged, false);
assert.equal(samePlan.classificationChanged, false);
assert.equal(samePlan.reliableChanged, false);
assert.equal(samePlan.executeChanged, false);
assert.equal(samePlan.timeoutDeltaMs, 0);

const replay = replayAssertionPlan('guard-impact', software, { minimumFps: 0.5 });
assert.equal(replay.equivalent, true);
assert.deepEqual(replay.first, replay.second);

const environmentSummary = buildEnvironmentAwareExecutionSummary(constrained);
assert.equal(environmentSummary.version, PLAYER_RUNTIME_ASSERTION_PLAN_VERSION);
assert.equal(environmentSummary.scenarios.length, 6);
assert.equal(environmentSummary.summary.count, 6);
assert.equal(environmentSummary.summary.constrainedCount, 6);
assert.equal(environmentSummary.summary.allReliable, true);
assert.ok(environmentSummary.scenarios.every((scenario) => scenario.valid));

const filteredSummary = buildEnvironmentAwareExecutionSummary(normal, ['stamina-dodge', 'dodge-iframe']);
assert.equal(filteredSummary.scenarios.length, 2);
assert.equal(filteredSummary.summary.count, 2);
assert.equal(filteredSummary.summary.runnableCount, 2);

const unknownSummary = buildEnvironmentAwareExecutionSummary(normal, ['unknown']);
assert.equal(unknownSummary.scenarios.length, 1);
assert.equal(unknownSummary.scenarios[0].scenario, 'stamina-dodge');

for (const scenario of Object.keys(PLAYER_RUNTIME_ASSERTION_SCENARIOS)) {
  for (const samples of [normal, constrained, software, sparse, [NaN, Infinity, -4, 0]]) {
    const plan = buildAssertionPlan(scenario, samples, { simulationSeconds: 0.5 });
    assert.ok(['inconclusive', 'runnable', 'runnable-constrained'].includes(plan.status));
    assert.ok(Number.isFinite(plan.timeoutMs));
    assert.ok(plan.timeoutMs >= 5000 && plan.timeoutMs <= 900000);
    assert.ok(Number.isFinite(plan.pollIntervalMs));
    assert.ok(plan.pollIntervalMs >= 25 && plan.pollIntervalMs <= 500);
  }
}

console.log('player runtime assertion plan regression: PASS');
