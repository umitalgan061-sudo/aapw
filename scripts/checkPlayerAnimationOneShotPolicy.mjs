import assert from 'node:assert/strict';
import {
  PLAYER_ANIMATION_ONESHOT_LIMITS,
  PLAYER_ANIMATION_ONESHOT_POLICY,
  PLAYER_ANIMATION_ONESHOT_STATES,
  advancePlayerAnimationOneShot,
  auditPlayerAnimationOneShotPolicy,
  createPlayerAnimationOneShotController,
  createPlayerAnimationOneShotState,
  forceEndPlayerAnimationOneShot,
  isPlayerAnimationOneShotActive,
  normalizePlayerAnimationOneShotRequest,
  resolvePlayerAnimationOneShotDecision,
  resolvePlayerAnimationOneShotFingerprint,
  resolvePlayerAnimationOneShotPhase,
  resolvePlayerAnimationOneShotWeight,
  startPlayerAnimationOneShot,
  tickPlayerAnimationOneShotController,
  validatePlayerAnimationOneShotState,
} from '../src/3d/gameplay/playerAnimationOneShotPolicy.js';

function test(name, callback) {
  callback();
  console.log(`[${name}] PASS`);
}

const initial = createPlayerAnimationOneShotState();

test('initial-state', () => {
  assert.equal(initial.phase, 'ready');
  assert.equal(initial.action, 'none');
  assert.equal(initial.remainingSeconds, 0);
  assert.equal(validatePlayerAnimationOneShotState(initial).ok, true);
});

test('constants', () => {
  assert.equal(PLAYER_ANIMATION_ONESHOT_POLICY.version, '2026-09-15-v1');
  assert.ok(PLAYER_ANIMATION_ONESHOT_STATES.includes('cooldown'));
  assert.equal(PLAYER_ANIMATION_ONESHOT_LIMITS.maxRequestsPerWindow, 4);
});

test('request-normalization', () => {
  const request = normalizePlayerAnimationOneShotRequest({ action: 42, windowSeconds: 99, priority: -2, variant: null });
  assert.equal(request.action, 'none');
  assert.equal(request.windowSeconds, PLAYER_ANIMATION_ONESHOT_LIMITS.maxWindowSeconds);
  assert.equal(request.priority, 0);
  assert.equal(request.variant, 'default');
  assert.equal(request.fingerprint.length, 8);
});

test('request-fingerprint-stable', () => {
  const request = { action: 'dodge', windowSeconds: 0.4, priority: 7, variant: 'evade-a' };
  assert.equal(resolvePlayerAnimationOneShotFingerprint(request), resolvePlayerAnimationOneShotFingerprint(request));
});

test('decision-ready', () => {
  const decision = resolvePlayerAnimationOneShotDecision(initial, { action: 'heavy-attack', windowSeconds: 0.7, priority: 8 }, 1);
  assert.equal(decision.accepted, true);
  assert.equal(decision.reason, 'ready');
});

test('decision-empty', () => {
  const decision = resolvePlayerAnimationOneShotDecision(initial, { action: '' }, 1);
  assert.equal(decision.accepted, false);
  assert.equal(decision.reason, 'empty-action');
});

test('start-transition', () => {
  const result = startPlayerAnimationOneShot(initial, { action: 'light-attack', windowSeconds: 0.5, priority: 5 }, 2);
  assert.equal(result.changed, true);
  assert.equal(result.state.phase, 'starting');
  assert.equal(result.state.action, 'light-attack');
  assert.equal(result.state.remainingSeconds, 0.5);
  assert.equal(result.state.transitionCount, 1);
});

test('start-holds-request-fingerprint', () => {
  const result = startPlayerAnimationOneShot(initial, { action: 'light-attack', windowSeconds: 0.5, priority: 5 }, 2);
  assert.equal(result.state.requestFingerprint, resolvePlayerAnimationOneShotFingerprint({ action: 'light-attack', windowSeconds: 0.5, priority: 5 }));
});

test('duplicate-gate', () => {
  const first = startPlayerAnimationOneShot(initial, { action: 'dodge', windowSeconds: 0.3, priority: 6 }, 1);
  const second = startPlayerAnimationOneShot(first.state, { action: 'dodge', windowSeconds: 0.3, priority: 6 }, 1.03);
  assert.equal(second.changed, false);
  assert.equal(second.decision.reason, 'duplicate');
});

test('priority-replace', () => {
  const first = startPlayerAnimationOneShot(initial, { action: 'light-attack', windowSeconds: 0.5, priority: 4 }, 1);
  const second = startPlayerAnimationOneShot(first.state, { action: 'heavy-attack', windowSeconds: 0.7, priority: 8 }, 1.3);
  assert.equal(second.changed, true);
  assert.equal(second.state.action, 'heavy-attack');
  assert.equal(second.decision.reason, 'priority-replace');
});

test('lower-priority-block', () => {
  const first = startPlayerAnimationOneShot(initial, { action: 'heavy-attack', windowSeconds: 0.7, priority: 8 }, 1);
  const second = startPlayerAnimationOneShot(first.state, { action: 'light-attack', windowSeconds: 0.5, priority: 2 }, 1.3);
  assert.equal(second.changed, false);
  assert.equal(second.decision.reason, 'lower-priority-active');
});

test('advance-start-to-hold', () => {
  const first = startPlayerAnimationOneShot(initial, { action: 'dodge', windowSeconds: 0.4, priority: 7 }, 1);
  const advanced = advancePlayerAnimationOneShot(first.state, 0.1);
  assert.equal(advanced.state.phase, 'holding');
  assert.equal(advanced.ended, false);
  assert.ok(advanced.state.remainingSeconds < 0.4);
});

test('advance-to-cooldown', () => {
  const first = startPlayerAnimationOneShot(initial, { action: 'dodge', windowSeconds: 0.4, priority: 7 }, 1);
  const advanced = advancePlayerAnimationOneShot(first.state, 0.5);
  assert.equal(advanced.state.phase, 'cooldown');
  assert.equal(advanced.ended, true);
});

test('cooldown-to-ready', () => {
  const first = startPlayerAnimationOneShot(initial, { action: 'dodge', windowSeconds: 0.1, priority: 7 }, 1);
  const cooldown = advancePlayerAnimationOneShot(first.state, 0.2);
  assert.equal(cooldown.state.phase, 'cooldown');
  const ready = advancePlayerAnimationOneShot(cooldown.state, PLAYER_ANIMATION_ONESHOT_LIMITS.minRetriggerGapSeconds);
  assert.equal(ready.state.phase, 'ready');
  assert.equal(ready.state.remainingSeconds, 0);
});

test('force-end', () => {
  const first = startPlayerAnimationOneShot(initial, { action: 'heavy-attack', windowSeconds: 0.8, priority: 8 }, 1);
  const ended = forceEndPlayerAnimationOneShot(first.state);
  assert.equal(ended.changed, true);
  assert.equal(ended.state.phase, 'cooldown');
  assert.equal(ended.state.remainingSeconds, PLAYER_ANIMATION_ONESHOT_LIMITS.minRetriggerGapSeconds);
});

test('weight-range', () => {
  const weights = [0, 0.03, 0.1, 0.2, 0.4, 0.7, 1.0].map((remaining) => resolvePlayerAnimationOneShotWeight(remaining, 1));
  for (const weight of weights) assert.ok(weight >= 0 && weight <= 1);
});

test('weight-fades-at-boundaries', () => {
  assert.equal(resolvePlayerAnimationOneShotWeight(1, 1), 0);
  assert.equal(resolvePlayerAnimationOneShotWeight(0, 1), 0);
  assert.ok(resolvePlayerAnimationOneShotWeight(0.5, 1) > 0);
});

test('phase-normalization', () => {
  assert.equal(resolvePlayerAnimationOneShotPhase({ phase: 'holding' }), 'holding');
  assert.equal(resolvePlayerAnimationOneShotPhase({ phase: 'unknown' }), 'ready');
  assert.equal(isPlayerAnimationOneShotActive({ phase: 'starting' }), true);
  assert.equal(isPlayerAnimationOneShotActive({ phase: 'cooldown' }), false);
});

test('controller-signals', () => {
  const signals = [];
  const controller = createPlayerAnimationOneShotController({ onSignal: (signal) => signals.push(signal) });
  controller.update(0, { action: 'light-attack', windowSeconds: 0.2, priority: 5 });
  controller.update(0.3, null);
  assert.ok(signals.some((signal) => signal.type === 'action-start'));
  assert.ok(signals.some((signal) => signal.type === 'action-end'));
});

test('controller-rejection-signal', () => {
  const signals = [];
  const controller = createPlayerAnimationOneShotController({ onSignal: (signal) => signals.push(signal) });
  controller.update(0, { action: 'dodge', windowSeconds: 0.2, priority: 7 });
  controller.update(0.01, { action: 'dodge', windowSeconds: 0.2, priority: 7 });
  assert.ok(signals.some((signal) => signal.type === 'action-rejected' && signal.reason === 'duplicate'));
});

test('controller-history-bound', () => {
  const controller = createPlayerAnimationOneShotController({ historyLimit: 3 });
  for (let index = 0; index < 12; index += 1) controller.update(0.2, { action: `action-${index}`, windowSeconds: 0.1, priority: 9 });
  assert.ok(controller.readHistory().length <= 3);
});

test('controller-reset', () => {
  const controller = createPlayerAnimationOneShotController();
  controller.update(0, { action: 'dodge', windowSeconds: 0.4, priority: 7 });
  controller.reset();
  assert.equal(controller.snapshot().state.phase, 'ready');
  assert.equal(controller.snapshot().sequence, 0);
});

test('tick-helper', () => {
  const result = tickPlayerAnimationOneShotController(initial, { action: 'dodge', windowSeconds: 0.3, priority: 7 }, 0.05, 1);
  assert.equal(result.started, true);
  assert.equal(result.validation.ok, true);
});

test('audit', () => {
  const audit = auditPlayerAnimationOneShotPolicy();
  assert.equal(audit.ok, true);
  assert.equal(audit.validation.ok, true);
});

const actionMatrix = ['idle', 'light-attack', 'heavy-attack', 'dodge', 'hit-stagger', 'guard'];
for (const action of actionMatrix) {
  test(`action-${action}`, () => {
    const state = createPlayerAnimationOneShotState();
    const result = startPlayerAnimationOneShot(state, { action, windowSeconds: 0.5, priority: 5 }, 1);
    assert.equal(result.changed, true);
    assert.equal(result.state.action, action);
    assert.equal(validatePlayerAnimationOneShotState(result.state).ok, true);
  });
}

const windowMatrix = [-1, 0, 0.03, 0.1, 0.5, 1, 2.5, 10, Infinity];
for (const windowSeconds of windowMatrix) {
  test(`window-${String(windowSeconds)}`, () => {
    const request = normalizePlayerAnimationOneShotRequest({ action: 'test', windowSeconds, priority: 5 });
    assert.ok(request.windowSeconds >= PLAYER_ANIMATION_ONESHOT_LIMITS.minWindowSeconds);
    assert.ok(request.windowSeconds <= PLAYER_ANIMATION_ONESHOT_LIMITS.maxWindowSeconds);
  });
}

const priorityMatrix = [-5, 0, 1, 4, 8, 9, 10, Infinity, NaN];
for (const priority of priorityMatrix) {
  test(`priority-${String(priority)}`, () => {
    const request = normalizePlayerAnimationOneShotRequest({ action: 'test', priority });
    assert.ok(request.priority >= 0 && request.priority <= 9);
  });
}

const deterministic = Array.from({ length: 40 }, (_, index) => ({
  action: index % 2 ? 'light-attack' : 'dodge',
  windowSeconds: 0.15 + (index % 5) * 0.05,
  priority: 4 + (index % 6),
}));

test('deterministic-sequence', () => {
  const run = () => {
    let state = createPlayerAnimationOneShotState();
    const output = [];
    for (let index = 0; index < deterministic.length; index += 1) {
      const started = startPlayerAnimationOneShot(state, deterministic[index], index * 0.2);
      state = started.state;
      output.push({ phase: state.phase, action: state.action, fingerprint: state.requestFingerprint, rejected: state.rejectionCount });
      state = advancePlayerAnimationOneShot(state, 0.2).state;
    }
    return JSON.stringify(output);
  };
  assert.equal(run(), run());
});

test('state-remains-bounded-under-repeat', () => {
  let state = createPlayerAnimationOneShotState();
  for (let index = 0; index < 250; index += 1) {
    const started = startPlayerAnimationOneShot(state, { action: index % 3 ? 'light-attack' : 'heavy-attack', windowSeconds: 0.2, priority: 6 }, index * 0.2);
    state = advancePlayerAnimationOneShot(started.state, 0.2).state;
    assert.ok(state.remainingSeconds >= 0);
    assert.ok(state.rejectionCount >= 0);
    assert.ok(state.transitionCount >= 0);
  }
  assert.equal(validatePlayerAnimationOneShotState(state).ok, true);
});

console.log('PLAYER_ANIMATION_ONESHOT_POLICY_REGRESSION_PASS');
