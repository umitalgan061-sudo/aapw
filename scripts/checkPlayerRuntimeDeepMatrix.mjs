import assert from 'node:assert/strict';
import { buildRuntimeBudgetDecision } from '../src/3d/gameplay/playerRuntimeBudgetPolicy.js';
import { buildRuntimeGateDecision } from '../src/3d/gameplay/playerRuntimeEnvironmentGate.js';
import { buildAssertionPlan, PLAYER_RUNTIME_ASSERTION_SCENARIOS } from '../src/3d/gameplay/playerRuntimeAssertionPlan.js';
import { appendRuntimeFrameSamples, createRuntimeTelemetryState, deriveRuntimeTelemetry, replayRuntimeTelemetry } from '../src/3d/gameplay/playerRuntimeTelemetry.js';

const cadenceSets = {
  normal: [0.016, 0.017, 0.018, 0.016, 0.015, 0.017, 0.016, 0.018],
  stable30: [0.033, 0.034, 0.032, 0.033, 0.034, 0.033, 0.032, 0.034],
  constrained: [0.11, 0.12, 0.13, 0.14, 0.12, 0.11, 0.13, 0.12],
  severe: [0.13, 0.21, 0.19, 0.24, 0.17, 0.23, 0.18, 0.25],
  software: [3.5, 3.5, 3.5, 8.6],
  empty: [],
  sparse: [0.016, 0.018],
};

for (const [name, samples] of Object.entries(cadenceSets)) {
  const state = appendRuntimeFrameSamples(createRuntimeTelemetryState({ maxSamples: 32 }), samples);
  const telemetry = deriveRuntimeTelemetry(state);
  const budget = buildRuntimeBudgetDecision(samples, { simulationSeconds: 1 });
  const gate = buildRuntimeGateDecision(samples, { action: `matrix-${name}`, simulationSeconds: 1 });
  assert.ok(Number.isFinite(telemetry.summary.fps));
  assert.ok(Number.isFinite(budget.timeoutMs));
  assert.ok(Number.isFinite(gate.timeoutMs));
  assert.ok(gate.status);
  assert.ok(['normal', 'constrained', 'severely-constrained', 'extremely-constrained'].includes(telemetry.classification));
  assert.ok(['inconclusive', 'runnable', 'runnable-constrained'].includes(gate.status));
}

for (const scenario of Object.keys(PLAYER_RUNTIME_ASSERTION_SCENARIOS)) {
  for (const [name, samples] of Object.entries(cadenceSets)) {
    const plan = buildAssertionPlan(scenario, samples);
    assert.equal(plan.scenario, scenario);
    assert.ok(Number.isFinite(plan.timeoutMs));
    assert.ok(Number.isFinite(plan.pollIntervalMs));
    assert.ok(plan.timeoutMs >= 5000 && plan.timeoutMs <= 900000);
    assert.ok(plan.pollIntervalMs >= 25 && plan.pollIntervalMs <= 500);
    if (name === 'sparse' || name === 'empty') assert.equal(plan.executeAssertions, false);
    if (name === 'normal') assert.equal(plan.status, 'runnable');
  }
}

const boundaries = [
  { name: 'fps30', samples: [1 / 30, 1 / 30, 1 / 30, 1 / 30], expected: 'normal' },
  { name: 'fps29', samples: [1 / 29, 1 / 29, 1 / 29, 1 / 29], expected: 'constrained' },
  { name: 'fps8', samples: [0.125, 0.125, 0.125, 0.125], expected: 'constrained' },
  { name: 'fps7', samples: [1 / 7, 1 / 7, 1 / 7, 1 / 7], expected: 'severely-constrained' },
  { name: 'fps1', samples: [1, 1, 1, 1], expected: 'severely-constrained' },
  { name: 'fps0', samples: [30, 30, 30, 30], expected: 'extremely-constrained' },
];
for (const boundary of boundaries) {
  const telemetry = deriveRuntimeTelemetry(appendRuntimeFrameSamples(createRuntimeTelemetryState({ maxSamples: 8 }), boundary.samples));
  assert.equal(telemetry.classification, boundary.expected, boundary.name);
}

const windows = [
  [0.016, 0.017, 0.016, 0.018],
  [0.033, 0.034, 0.032, 0.034],
  [0.11, 0.12, 0.13, 0.14],
  [0.5, 0.5, 0.5, 0.5],
  [1, 1, 1, 1],
  [3.5, 3.5, 3.5, 8.6],
];
for (const samples of windows) {
  const first = buildRuntimeGateDecision(samples, { action: 'window', simulationSeconds: 0.5 });
  const second = buildRuntimeGateDecision([...samples], { action: 'window', simulationSeconds: 0.5 });
  assert.deepEqual(first, second);
}

const transitionPairs = [
  [cadenceSets.normal, cadenceSets.constrained],
  [cadenceSets.constrained, cadenceSets.normal],
  [cadenceSets.constrained, cadenceSets.severe],
  [cadenceSets.severe, cadenceSets.constrained],
  [cadenceSets.severe, cadenceSets.software],
  [cadenceSets.software, cadenceSets.normal],
];
for (const [before, after] of transitionPairs) {
  const a = buildRuntimeBudgetDecision(before, { simulationSeconds: 1 });
  const b = buildRuntimeBudgetDecision(after, { simulationSeconds: 1 });
  assert.ok(Number.isFinite(a.timeoutMs));
  assert.ok(Number.isFinite(b.timeoutMs));
  assert.notEqual(a.classification === 'normal' && b.classification === 'normal' && before.join(',') !== after.join(','), true);
}

const maliciousInputs = [
  { samples: [NaN, Infinity, -Infinity, -1], action: null, simulationSeconds: NaN },
  { samples: [Number.MAX_VALUE, Number.MIN_VALUE, 0, 0], action: {}, simulationSeconds: Infinity },
  { samples: [null, undefined, false, true], action: [], simulationSeconds: -100 },
  { samples: [0.016, null, 0.017, '0.018'], action: 'safe', simulationSeconds: 1 },
];
for (const input of maliciousInputs) {
  const gate = buildRuntimeGateDecision(input.samples, input);
  assert.ok(['inconclusive', 'runnable', 'runnable-constrained'].includes(gate.status));
  assert.ok(Number.isFinite(gate.timeoutMs));
  assert.ok(Number.isFinite(gate.pollIntervalMs));
}

const repeated = replayRuntimeTelemetry(cadenceSets.software, { minimumSamples: 4, windowSize: 4 });
assert.equal(repeated.equivalent, true);

const state = appendRuntimeFrameSamples(createRuntimeTelemetryState({ maxSamples: 4 }), [0.016, 0.017, 0.018, 0.019, 0.020, 0.021]);
assert.equal(state.samples.length, 4);
assert.equal(state.droppedSamples, 2);
assert.equal(state.sequence, 6);

const gateNormal = buildRuntimeGateDecision(cadenceSets.normal, { simulationSeconds: 0, action: 'zero' });
assert.ok(gateNormal.timeoutMs >= 5000);
const gateLong = buildRuntimeGateDecision(cadenceSets.normal, { simulationSeconds: 4, action: 'long' });
assert.ok(gateLong.timeoutMs >= gateNormal.timeoutMs);
assert.ok(gateLong.timeoutMs <= 900000);

const gateStrict = buildRuntimeGateDecision(cadenceSets.normal, { minimumFps: 60, action: 'strict' });
assert.equal(gateStrict.status, 'runnable');
const gateTooStrict = buildRuntimeGateDecision(cadenceSets.normal, { minimumFps: 120, action: 'too-strict' });
assert.equal(gateTooStrict.status, 'inconclusive');

for (const extraMultiplier of [1, 1.25, 2, 4, 20, 999, 0, NaN, Infinity]) {
  const decision = buildRuntimeBudgetDecision(cadenceSets.constrained, { simulationSeconds: 1, extraMultiplier });
  assert.ok(decision.timeoutMs >= 5000);
  assert.ok(decision.timeoutMs <= 900000);
}

console.log('player runtime deep matrix regression: PASS');
