import assert from 'node:assert/strict';
import {
  PLAYER_ANIMATION_TEMPORAL_LIMITS,
  PLAYER_ANIMATION_TEMPORAL_POLICY,
  PLAYER_ANIMATION_TEMPORAL_SIGNAL_TYPES,
  auditPlayerAnimationTemporalPolicy,
  buildPlayerAnimationTemporalWarning,
  comparePlayerAnimationTemporalScenarios,
  createPlayerAnimationTemporalController,
  createPlayerAnimationTemporalInitialState,
  createPlayerAnimationTemporalReadModel,
  createPlayerAnimationTemporalScenario,
  getPlayerAnimationTemporalCapabilities,
  getPlayerAnimationTemporalLimits,
  isPlayerAnimationCombatSemantic,
  isPlayerAnimationLocomotionSemantic,
  isPlayerAnimationTemporalSignal,
  normalizePlayerAnimationTemporalInput,
  normalizePlayerAnimationTemporalPhase,
  resolvePlayerAnimationSignalBudget,
  resolvePlayerAnimationSurfacePresentation,
  resolvePlayerAnimationTemporalBudget,
  resolvePlayerAnimationTemporalFingerprint,
  resolvePlayerAnimationTemporalPlaybackRate,
  resolvePlayerAnimationTemporalStride,
  resolvePlayerAnimationTemporalStep,
  resolvePlayerAnimationTemporalTransition,
  resolvePlayerAnimationTemporalTransitionReason,
  resolvePlayerAnimationTemporalStep as step,
  validatePlayerAnimationTemporalState,
} from '../src/3d/gameplay/playerAnimationTemporalPolicy.js';

function test(name, callback) {
  callback();
  console.log(`[${name}] PASS`);
}

function runScenario(samples) {
  return createPlayerAnimationTemporalScenario(samples);
}

const state = createPlayerAnimationTemporalInitialState();

test('initial-state', () => {
  assert.equal(state.semanticState, 'idle');
  assert.equal(state.phase, 0);
  assert.equal(state.frameCount, 0);
  assert.equal(state.transitionCount, 0);
  assert.equal(state.footstepCount, 0);
  assert.equal(validatePlayerAnimationTemporalState(state).ok, true);
});

test('policy-contract', () => {
  assert.equal(PLAYER_ANIMATION_TEMPORAL_POLICY.version, '2026-09-15-v1');
  assert.equal(PLAYER_ANIMATION_TEMPORAL_LIMITS.maxDeltaSeconds, 0.1);
  assert.ok(PLAYER_ANIMATION_TEMPORAL_LIMITS.maxCatchUpSteps >= 4);
  assert.ok(PLAYER_ANIMATION_TEMPORAL_SIGNAL_TYPES.includes('footstep'));
  assert.ok(getPlayerAnimationTemporalCapabilities().includes('presentation-only-ownership'));
});

test('input-normalization', () => {
  const input = normalizePlayerAnimationTemporalInput({
    planarSpeedMps: Infinity,
    runIntent: 1,
    attackKind: 42,
    phase: -2.25,
    phaseScale: 99,
    baseRate: -4,
    environmentRateScale: 4,
    surface: { confidence: 9, slip: -2 },
  });
  assert.equal(input.planarSpeedMps, 0);
  assert.equal(input.runIntent, false);
  assert.equal(input.attackKind, 'none');
  assert.equal(input.phase, 0.75);
  assert.equal(input.phaseScale, 2);
  assert.equal(input.baseRate, 0.5);
  assert.equal(input.environmentRateScale, 1.35);
  assert.equal(input.surface.confidence, 1);
  assert.equal(input.surface.slip, 0);
});

test('phase-normalization', () => {
  assert.equal(normalizePlayerAnimationTemporalPhase(1), 0);
  assert.equal(normalizePlayerAnimationTemporalPhase(-0.2), 0.8);
  assert.equal(normalizePlayerAnimationTemporalPhase(2.35), 0.35);
  assert.equal(normalizePlayerAnimationTemporalPhase(NaN), 0);
});

test('sprint-hysteresis', () => {
  const locomotion = resolvePlayerAnimationTemporalTransition({ planarSpeedMps: 5.55 });
  assert.equal(locomotion.semanticState, 'locomotion');
  const sprint = resolvePlayerAnimationTemporalTransition({ planarSpeedMps: 5.6 }, locomotion);
  assert.equal(sprint.semanticState, 'sprint');
  const held = resolvePlayerAnimationTemporalTransition({ planarSpeedMps: 5.25 }, sprint);
  assert.equal(held.semanticState, 'sprint');
  const exit = resolvePlayerAnimationTemporalTransition({ planarSpeedMps: 5.09 }, held);
  assert.equal(exit.semanticState, 'locomotion');
});

test('combat-priority', () => {
  const attack = resolvePlayerAnimationTemporalTransition({ planarSpeedMps: 6.2, attackKind: 'heavy' });
  assert.equal(attack.semanticState, 'heavy-attack');
  const dodge = resolvePlayerAnimationTemporalTransition({ planarSpeedMps: 6.2, dodgeRemaining: 0.2, attackKind: 'light' });
  assert.equal(dodge.semanticState, 'dodge');
  const stagger = resolvePlayerAnimationTemporalTransition({ planarSpeedMps: 6.2, hitStaggerRemaining: 0.2, dodgeRemaining: 0.2 });
  assert.equal(stagger.semanticState, 'hit-stagger');
});

test('transition-reasons', () => {
  assert.equal(resolvePlayerAnimationTemporalTransitionReason('locomotion', 'sprint', { planarSpeedMps: 6 }), 'sprint-enter');
  assert.equal(resolvePlayerAnimationTemporalTransitionReason('sprint', 'locomotion', { planarSpeedMps: 4.5 }), 'sprint-exit');
  assert.equal(resolvePlayerAnimationTemporalTransitionReason('idle', 'heavy-attack', { attackKind: 'heavy' }), 'combat-heavy-attack');
  assert.equal(resolvePlayerAnimationTemporalTransitionReason('locomotion', 'locomotion', { planarSpeedMps: 3 }), 'state-held');
});

test('rate-resolution', () => {
  const idle = resolvePlayerAnimationTemporalPlaybackRate({ semanticState: 'idle', planarSpeedMps: 0 });
  const walk = resolvePlayerAnimationTemporalPlaybackRate({ semanticState: 'locomotion', planarSpeedMps: 3.2 });
  const sprint = resolvePlayerAnimationTemporalPlaybackRate({ semanticState: 'sprint', planarSpeedMps: 7 });
  const dodge = resolvePlayerAnimationTemporalPlaybackRate({ semanticState: 'dodge', planarSpeedMps: 1 });
  assert.equal(idle, 1);
  assert.equal(walk, 1);
  assert.ok(sprint > walk);
  assert.ok(dodge > sprint);
});

test('stride-resolution', () => {
  assert.equal(resolvePlayerAnimationTemporalStride({ semanticState: 'idle', planarSpeedMps: 0 }), null);
  const walk = resolvePlayerAnimationTemporalStride({ semanticState: 'locomotion', planarSpeedMps: 3.2 });
  const sprint = resolvePlayerAnimationTemporalStride({ semanticState: 'sprint', planarSpeedMps: 6.4 });
  assert.ok(walk > 0);
  assert.ok(sprint > 0);
  assert.ok(sprint < walk);
});

test('single-step-idle', () => {
  const result = resolvePlayerAnimationTemporalStep(state, {}, 0.1);
  assert.equal(result.state.semanticState, 'idle');
  assert.equal(result.state.phase, 0);
  assert.equal(result.footsteps.length, 0);
  assert.equal(result.state.frameCount, 1);
});

test('single-step-walk', () => {
  const result = resolvePlayerAnimationTemporalStep(state, { planarSpeedMps: 3.2, surface: { materialKey: 'stone', confidence: 1 } }, 0.1);
  assert.equal(result.state.semanticState, 'locomotion');
  assert.ok(result.state.phase > 0);
  assert.equal(result.state.surface.materialKey, 'stone');
  assert.equal(validatePlayerAnimationTemporalState(result.state).ok, true);
});

test('controller-transition-signal', () => {
  const signals = [];
  const controller = createPlayerAnimationTemporalController({ emitSignal: (signal) => signals.push(signal) });
  controller.update(0.05, { planarSpeedMps: 0 });
  controller.update(0.05, { planarSpeedMps: 6.2, runIntent: true });
  assert.ok(signals.some((signal) => signal.type === 'transition' && signal.to === 'sprint'));
});

test('controller-action-signals', () => {
  const signals = [];
  const controller = createPlayerAnimationTemporalController({ emitSignal: (signal) => signals.push(signal) });
  controller.update(0.05, { attackKind: 'light' });
  assert.ok(signals.some((signal) => signal.type === 'action-start' && signal.semanticState === 'light-attack'));
});

test('surface-change-signal', () => {
  const signals = [];
  const controller = createPlayerAnimationTemporalController({ emitSignal: (signal) => signals.push(signal) });
  controller.update(0.05, { planarSpeedMps: 2, surface: { materialKey: 'grass', confidence: 1 } });
  controller.update(0.05, { planarSpeedMps: 2, surface: { materialKey: 'stone', confidence: 1 } });
  assert.ok(signals.some((signal) => signal.type === 'surface-change' && signal.to === 'stone'));
});

test('footstep-signal-determinism', () => {
  const samples = Array.from({ length: 32 }, () => ({ deltaSeconds: 0.1, input: { planarSpeedMps: 4.2, surface: { materialKey: 'stone', confidence: 1 } } }));
  const first = runScenario(samples);
  const second = runScenario(samples);
  assert.equal(first.fingerprint, second.fingerprint);
  assert.equal(JSON.stringify(first.signals), JSON.stringify(second.signals));
  assert.ok(first.footstepCount > 0);
});

test('muted-surface-gates-steps', () => {
  const samples = Array.from({ length: 48 }, () => ({ deltaSeconds: 0.1, input: { planarSpeedMps: 4.8, surface: { materialKey: 'mud', confidence: 1, muted: true } } }));
  const result = runScenario(samples);
  assert.equal(result.footstepCount, 0);
  assert.equal(result.signals.filter((signal) => signal.type === 'footstep').length, 0);
});

test('low-confidence-surface-gates-steps', () => {
  const samples = Array.from({ length: 48 }, () => ({ deltaSeconds: 0.1, input: { planarSpeedMps: 4.8, surface: { materialKey: 'unknown', confidence: 0.1 } } }));
  const result = runScenario(samples);
  assert.equal(result.footstepCount, 0);
});

test('surface-presentation', () => {
  const normal = resolvePlayerAnimationSurfacePresentation({ materialKey: 'stone', confidence: 1, slip: 0 });
  const slippery = resolvePlayerAnimationSurfacePresentation({ materialKey: 'ice', confidence: 1, slip: 1 });
  const unknown = resolvePlayerAnimationSurfacePresentation({ materialKey: 'unknown', confidence: 0 });
  assert.equal(normal.muted, false);
  assert.ok(normal.footstepGain > slippery.footstepGain);
  assert.equal(unknown.muted, true);
  assert.equal(unknown.footstepGain, 0);
});

test('signal-budget-priority', () => {
  const signals = PLAYER_ANIMATION_TEMPORAL_SIGNAL_TYPES.map((type, index) => ({ type, index }));
  const limited = resolvePlayerAnimationSignalBudget(signals, 3);
  assert.equal(limited.length, 3);
  assert.equal(limited[0].type, 'presentation-warning');
  assert.equal(limited[1].type, 'transition');
  assert.equal(limited[2].type, 'action-start');
});

test('signal-budget-stable-order', () => {
  const signals = [
    { type: 'footstep', index: 1 },
    { type: 'footstep', index: 2 },
    { type: 'transition', index: 3 },
    { type: 'transition', index: 4 },
  ];
  const limited = resolvePlayerAnimationSignalBudget(signals, 4);
  assert.deepEqual(limited.map((item) => item.index), [3, 4, 1, 2]);
});

test('budget-clamp', () => {
  const zero = resolvePlayerAnimationTemporalBudget(-1);
  const huge = resolvePlayerAnimationTemporalBudget(999);
  assert.equal(zero.clampedSeconds, 0);
  assert.equal(huge.clampedSeconds, PLAYER_ANIMATION_TEMPORAL_LIMITS.maxCatchUpSeconds);
  assert.equal(huge.catchUpLimited, true);
});

test('catch-up-bounded', () => {
  const controller = createPlayerAnimationTemporalController();
  const result = controller.update(9, { planarSpeedMps: 6.5, surface: { materialKey: 'stone', confidence: 1 } });
  assert.ok(result.steps <= PLAYER_ANIMATION_TEMPORAL_LIMITS.maxCatchUpSteps);
  assert.ok(result.state.elapsedSeconds <= PLAYER_ANIMATION_TEMPORAL_LIMITS.maxCatchUpSeconds + 0.0001);
});

test('read-model', () => {
  const controller = createPlayerAnimationTemporalController();
  controller.update(0.1, { planarSpeedMps: 3.2 });
  const readModel = createPlayerAnimationTemporalReadModel(controller);
  assert.equal(readModel.available, true);
  assert.equal(readModel.semanticState, 'locomotion');
  assert.equal(typeof readModel.fingerprint, 'string');
  assert.ok(readModel.history.length >= 1);
});

test('fingerprint-sensitive', () => {
  const controller = createPlayerAnimationTemporalController();
  const before = controller.snapshot().fingerprint;
  controller.update(0.1, { planarSpeedMps: 3.2 });
  const after = controller.snapshot().fingerprint;
  assert.notEqual(before, after);
  assert.equal(after, resolvePlayerAnimationTemporalFingerprint(controller.snapshot().state));
});

test('reset-clears-history', () => {
  const controller = createPlayerAnimationTemporalController();
  controller.update(0.1, { planarSpeedMps: 3.2 });
  assert.ok(controller.readHistory().length > 0);
  controller.reset();
  assert.equal(controller.readHistory().length, 0);
  assert.equal(controller.snapshot().state.frameCount, 0);
});

test('scenario-deterministic', () => {
  const samples = [
    { deltaSeconds: 0.1, input: { planarSpeedMps: 0 } },
    { deltaSeconds: 0.1, input: { planarSpeedMps: 3.2, surface: { materialKey: 'grass', confidence: 0.9 } } },
    { deltaSeconds: 0.1, input: { planarSpeedMps: 5.7, runIntent: true, surface: { materialKey: 'grass', confidence: 0.9 } } },
    { deltaSeconds: 0.1, input: { planarSpeedMps: 5.3, surface: { materialKey: 'grass', confidence: 0.9 } } },
    { deltaSeconds: 0.1, input: { planarSpeedMps: 5.0, attackKind: 'heavy' } },
  ];
  const comparison = comparePlayerAnimationTemporalScenarios(samples, samples);
  assert.equal(comparison.equal, true);
  assert.equal(comparison.first.fingerprint, comparison.second.fingerprint);
});

test('semantic-classification', () => {
  assert.equal(isPlayerAnimationCombatSemantic('heavy-attack'), true);
  assert.equal(isPlayerAnimationCombatSemantic('locomotion'), false);
  assert.equal(isPlayerAnimationLocomotionSemantic('sprint'), true);
  assert.equal(isPlayerAnimationLocomotionSemantic('guard'), false);
});

test('signal-type-classification', () => {
  for (const type of PLAYER_ANIMATION_TEMPORAL_SIGNAL_TYPES) assert.equal(isPlayerAnimationTemporalSignal(type), true);
  assert.equal(isPlayerAnimationTemporalSignal('unknown'), false);
});

test('warning-policy', () => {
  const warning = buildPlayerAnimationTemporalWarning(state, { planarSpeedMps: Infinity, deltaSeconds: 1 });
  assert.ok(warning.warnings.includes('malformed-speed'));
  assert.ok(warning.warnings.includes('delta-clamped'));
});

test('audit-policy', () => {
  const audit = auditPlayerAnimationTemporalPolicy();
  assert.equal(audit.ok, true);
  assert.equal(audit.validation.ok, true);
  assert.equal(audit.budget.catchUpLimited, true);
});

test('limits-copy', () => {
  const limits = getPlayerAnimationTemporalLimits();
  assert.equal(limits.maxDeltaSeconds, PLAYER_ANIMATION_TEMPORAL_LIMITS.maxDeltaSeconds);
  assert.deepEqual(limits.footstepPhase, undefined);
  assert.ok(Object.isFrozen(limits));
});

const speedMatrix = [0, 0.05, 0.15, 1, 3.2, 5.09, 5.1, 5.55, 5.6, 6.5, 9, Infinity, NaN];
for (const speed of speedMatrix) {
  test(`speed-matrix-${String(speed)}`, () => {
    const transition = resolvePlayerAnimationTemporalTransition({ planarSpeedMps: speed });
    assert.ok(['idle', 'locomotion', 'sprint'].includes(transition.semanticState));
    assert.equal(validatePlayerAnimationTemporalState(transition).ok, true);
  });
}

const surfaceMatrix = [
  { materialKey: 'grass', confidence: 1, slip: 0 },
  { materialKey: 'stone', confidence: 0.7, slip: 0.2 },
  { materialKey: 'mud', confidence: 0.3, slip: 0.8 },
  { materialKey: 'ice', confidence: 1, slip: 1 },
  { materialKey: 'unknown', confidence: 0, slip: 0 },
];
for (const surface of surfaceMatrix) {
  test(`surface-matrix-${surface.materialKey}`, () => {
    const result = resolvePlayerAnimationSurfacePresentation(surface);
    assert.ok(result.confidence >= 0 && result.confidence <= 1);
    assert.ok(result.playbackScale >= 0.8 && result.playbackScale <= 1.05);
    if (result.muted) assert.equal(result.footstepGain, 0);
  });
}

const actionMatrix = [
  ['none', 'locomotion'],
  ['light', 'light-attack'],
  ['heavy', 'heavy-attack'],
];
for (const [attackKind, expected] of actionMatrix) {
  test(`action-matrix-${attackKind}`, () => {
    const result = resolvePlayerAnimationTemporalTransition({ planarSpeedMps: 3, attackKind });
    assert.equal(result.semanticState, expected);
  });
}

const dtMatrix = [-1, 0, 0.016, 0.033, 0.05, 0.1, 0.2, 1, 10];
for (const deltaSeconds of dtMatrix) {
  test(`delta-matrix-${String(deltaSeconds)}`, () => {
    const budget = resolvePlayerAnimationTemporalBudget(deltaSeconds);
    assert.ok(budget.clampedSeconds >= 0);
    assert.ok(budget.clampedSeconds <= PLAYER_ANIMATION_TEMPORAL_LIMITS.maxCatchUpSeconds);
  });
}

const repeatedSamples = Array.from({ length: 120 }, (_, index) => ({
  deltaSeconds: index % 7 === 0 ? 0.033 : 0.1,
  input: {
    planarSpeedMps: index % 18 < 6 ? 3.2 : 6.2,
    runIntent: index % 18 >= 6 && index % 18 < 12,
    attackKind: index % 41 === 0 ? 'heavy' : 'none',
    surface: { materialKey: index % 2 ? 'grass' : 'stone', confidence: 0.8, slip: index % 5 === 0 ? 0.4 : 0.1 },
  },
}));

test('long-repeat-regression', () => {
  const result = runScenario(repeatedSamples);
  const replay = runScenario(repeatedSamples);
  assert.equal(result.fingerprint, replay.fingerprint);
  assert.equal(result.frameCount >= repeatedSamples.length, true);
  assert.equal(result.transitionCount < repeatedSamples.length, true);
  assert.ok(result.footstepCount >= 0);
});

test('controller-signal-bound', () => {
  const controller = createPlayerAnimationTemporalController();
  for (const sample of repeatedSamples) controller.update(sample.deltaSeconds, sample.input);
  assert.ok(controller.readHistory().length <= 48);
});

test('step-alias-consistency', () => {
  const a = resolvePlayerAnimationTemporalStep(createPlayerAnimationTemporalInitialState(), { planarSpeedMps: 3.2 }, 0.05);
  const b = step(createPlayerAnimationTemporalInitialState(), { planarSpeedMps: 3.2 }, 0.05);
  assert.deepEqual(a.state, b.state);
});

console.log('PLAYER_ANIMATION_TEMPORAL_POLICY_REGRESSION_PASS');
