import assert from 'node:assert/strict';
import {
  PLAYER_RUNTIME_GATE_VERSION,
  normalizeGateIntent,
  buildRuntimeGateDecision,
  shouldExecuteInteractiveAssertion,
  describeGateDecision,
  createGateEvidence,
  replayGateDecision,
  compareGateWindows,
  buildGateScenarioMatrix,
  verifyGateScenarioMatrix,
} from '../src/3d/gameplay/playerRuntimeEnvironmentGate.js';

const normal = [0.016, 0.017, 0.016, 0.018, 0.015, 0.017, 0.016, 0.018];
const constrained = [0.11, 0.12, 0.13, 0.14, 0.12, 0.11, 0.13, 0.12];
const software = [3.5, 3.5, 3.5, 8.6];
const sparse = [0.016, 0.018];

assert.equal(PLAYER_RUNTIME_GATE_VERSION, '2026-09-15-v1');

const defaultIntent = normalizeGateIntent();
assert.equal(defaultIntent.action, 'interactive-assertion');
assert.equal(defaultIntent.simulationSeconds, 1);
assert.equal(defaultIntent.minimumFps, 0.5);
assert.ok(Object.isFrozen(defaultIntent));

const hostileIntent = normalizeGateIntent({ action: '', simulationSeconds: Infinity, minimumFps: -4 });
assert.equal(hostileIntent.action, 'interactive-assertion');
assert.equal(hostileIntent.simulationSeconds, 4);
assert.equal(hostileIntent.minimumFps, 0.1);

const normalDecision = buildRuntimeGateDecision(normal, { action: 'sprint-dodge', simulationSeconds: 1 });
assert.equal(normalDecision.version, PLAYER_RUNTIME_GATE_VERSION);
assert.equal(normalDecision.status, 'runnable');
assert.equal(normalDecision.reliable, true);
assert.equal(normalDecision.executeAssertions, true);
assert.equal(shouldExecuteInteractiveAssertion(normalDecision), true);
assert.ok(normalDecision.timeoutMs >= 5000);
assert.ok(normalDecision.pollIntervalMs >= 25);
assert.ok(Object.isFrozen(normalDecision));
assert.ok(Object.isFrozen(normalDecision.transcript));
assert.ok(Object.isFrozen(normalDecision.budget));

const constrainedDecision = buildRuntimeGateDecision(constrained, { action: 'guard-parry', simulationSeconds: 1 });
assert.equal(constrainedDecision.status, 'runnable-constrained');
assert.equal(constrainedDecision.reliable, true);
assert.equal(shouldExecuteInteractiveAssertion(constrainedDecision), true);
assert.ok(constrainedDecision.timeoutMs > normalDecision.timeoutMs);
assert.ok(constrainedDecision.reason.includes('extended timeout'));

const softwareDecision = buildRuntimeGateDecision(software, { action: 'stamina-dodge', simulationSeconds: 1 });
assert.equal(softwareDecision.reliable, true);
assert.equal(softwareDecision.executeAssertions, true);
assert.equal(softwareDecision.status, 'runnable-constrained');
assert.equal(softwareDecision.classification, 'severely-constrained');
assert.ok(softwareDecision.timeoutMs > constrainedDecision.timeoutMs);
assert.ok(softwareDecision.timeoutMs <= 900000);

const sparseDecision = buildRuntimeGateDecision(sparse, { action: 'hit-stagger' });
assert.equal(sparseDecision.status, 'inconclusive');
assert.equal(sparseDecision.reliable, false);
assert.equal(sparseDecision.executeAssertions, false);
assert.equal(shouldExecuteInteractiveAssertion(sparseDecision), false);
assert.ok(sparseDecision.reason.includes('insufficient'));

const malformedDecision = buildRuntimeGateDecision([NaN, Infinity, -1, 0], { action: 'malformed' });
assert.equal(malformedDecision.status, 'inconclusive');
assert.equal(malformedDecision.reliable, false);
assert.equal(malformedDecision.executeAssertions, false);

assert.match(describeGateDecision(normalDecision), /^RUNNABLE:/);
assert.match(describeGateDecision(constrainedDecision), /^RUNNABLE-CONSTRAINED:/);
assert.match(describeGateDecision(sparseDecision), /^INCONCLUSIVE:/);
assert.match(describeGateDecision({ status: 'unknown' }), /^UNKNOWN:/);

const normalEvidence = createGateEvidence(normalDecision);
assert.equal(normalEvidence.valid, true);
assert.equal(normalEvidence.gateVersion, PLAYER_RUNTIME_GATE_VERSION);
assert.equal(normalEvidence.status, 'runnable');
assert.equal(normalEvidence.reliable, true);
assert.equal(normalEvidence.executeAssertions, true);
assert.ok(normalEvidence.timeoutMs >= 5000);
assert.ok(normalEvidence.pollIntervalMs >= 25);

const sparseEvidence = createGateEvidence(sparseDecision);
assert.equal(sparseEvidence.valid, true);
assert.equal(sparseEvidence.status, 'inconclusive');
assert.equal(sparseEvidence.reliable, false);

const replay = replayGateDecision(software, { action: 'replay-proof', simulationSeconds: 1 });
assert.equal(replay.equivalent, true);
assert.deepEqual(replay.first, replay.second);
assert.deepEqual(JSON.stringify(replay.first), JSON.stringify(replay.second));

const faster = compareGateWindows(software, normal, { action: 'recovery' });
assert.equal(faster.firstStatus, 'runnable-constrained');
assert.equal(faster.secondStatus, 'runnable');
assert.equal(faster.secondReliable, true);
assert.equal(faster.firstReliable, true);
assert.ok(faster.timeoutDeltaMs < 0);
assert.ok(faster.fpsDelta > 0);
assert.equal(faster.classificationChanged, true);

const slower = compareGateWindows(normal, software, { action: 'slow-render' });
assert.ok(slower.timeoutDeltaMs > 0);
assert.ok(slower.fpsDelta < 0);
assert.equal(slower.classificationChanged, true);

const stable = compareGateWindows(normal, normal, { action: 'stable-render' });
assert.equal(stable.classificationChanged, false);
assert.equal(stable.timeoutDeltaMs, 0);
assert.equal(stable.fpsDelta, 0);

const matrix = buildGateScenarioMatrix();
assert.equal(matrix.length, 5);
assert.ok(matrix.every((scenario) => scenario.id && Array.isArray(scenario.samples) && scenario.expected));
assert.ok(Object.isFrozen(matrix));
assert.ok(matrix.every(Object.isFrozen));

const matrixResult = verifyGateScenarioMatrix();
assert.equal(matrixResult.valid, true);
assert.equal(matrixResult.count, matrix.length);
assert.ok(matrixResult.results.every((result) => result.matches));

for (const simulationSeconds of [0, 0.1, 0.5, 1, 2, 4, 99, Infinity, NaN]) {
  const decision = buildRuntimeGateDecision(normal, { simulationSeconds });
  assert.ok(decision.simulationSeconds >= 0);
  assert.ok(decision.simulationSeconds <= 4);
  assert.ok(decision.timeoutMs >= 5000 && decision.timeoutMs <= 900000);
}

for (const minimumFps of [0.1, 0.5, 1, 5, 30, 120, -5, Infinity, NaN]) {
  const decision = buildRuntimeGateDecision(constrained, { minimumFps });
  assert.ok(decision.minimumFps >= 0.1 && decision.minimumFps <= 120);
  assert.ok(['inconclusive', 'runnable', 'runnable-constrained'].includes(decision.status));
}

for (const samples of [normal, constrained, software, sparse, [], [0.001, 0.002, 0.003, 0.004], [30, 30, 30, 30]]) {
  const decision = buildRuntimeGateDecision(samples, { simulationSeconds: 1 });
  const evidence = createGateEvidence(decision);
  assert.equal(evidence.valid, true);
  assert.ok(Number.isFinite(decision.timeoutMs));
  assert.ok(Number.isFinite(decision.pollIntervalMs));
  assert.ok(decision.timeoutMs >= 5000 && decision.timeoutMs <= 900000);
}

console.log('player runtime environment gate regression: PASS');
