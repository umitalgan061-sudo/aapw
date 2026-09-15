import assert from 'node:assert/strict';
import {
  PLAYER_ANIMATION_SIGNAL_LIMITS,
  auditPlayerAnimationSignalSanitizer,
  createPlayerAnimationSignalPacket,
  filterPlayerAnimationSignalsByLifetime,
  getPlayerAnimationSignalLimits,
  getPlayerAnimationSignalTypes,
  isPlayerAnimationSignalType,
  sanitizePlayerAnimationSignal,
  sanitizePlayerAnimationSignalBatch,
  validatePlayerAnimationSignal,
} from '../src/3d/gameplay/playerAnimationSignalSanitizer.js';

function test(name, callback) {
  callback();
  console.log(`[${name}] PASS`);
}

test('audit', () => {
  const audit = auditPlayerAnimationSignalSanitizer();
  assert.equal(audit.ok, true);
  assert.equal(audit.validation.ok, true);
});

test('footstep-sanitize', () => {
  const signal = sanitizePlayerAnimationSignal({ type: 'footstep', sequence: -4, atSeconds: -2, foot: 'bad', intensity: 9, phase: -0.2, materialKey: 'x'.repeat(100) });
  assert.equal(signal.type, 'footstep');
  assert.equal(signal.sequence, 0);
  assert.equal(signal.atSeconds, 0);
  assert.equal(signal.foot, 'left');
  assert.equal(signal.intensity, 1);
  assert.equal(signal.phase, 0.8);
  assert.equal(signal.materialKey.length, PLAYER_ANIMATION_SIGNAL_LIMITS.maxTextLength);
  assert.equal(validatePlayerAnimationSignal(signal).ok, true);
});

test('transition-sanitize', () => {
  const signal = sanitizePlayerAnimationSignal({ type: 'transition', from: 3, to: 4, reason: 'x'.repeat(100) });
  assert.equal(signal.from.length > 0, true);
  assert.equal(signal.to.length > 0, true);
  assert.ok(signal.reason.length <= PLAYER_ANIMATION_SIGNAL_LIMITS.maxTextLength);
  assert.equal(validatePlayerAnimationSignal(signal).ok, true);
});

test('unknown-type-fallback', () => {
  const signal = sanitizePlayerAnimationSignal({ type: 'not-real' });
  assert.equal(signal.type, 'presentation-warning');
  assert.deepEqual(signal.warnings, ['unknown-type']);
  assert.equal(validatePlayerAnimationSignal(signal).ok, true);
});

test('batch-bound', () => {
  const input = Array.from({ length: 40 }, (_, sequence) => ({ type: 'footstep', sequence }));
  const output = sanitizePlayerAnimationSignalBatch(input, 5);
  assert.equal(output.length, 5);
  assert.deepEqual(output.map((item) => item.sequence), [0, 1, 2, 3, 4]);
});

test('batch-invalid-input', () => {
  const output = sanitizePlayerAnimationSignalBatch(null, 10);
  assert.deepEqual(output, []);
});

test('lifetime-filter', () => {
  const signals = [
    { type: 'footstep', sequence: 1, atSeconds: 9 },
    { type: 'footstep', sequence: 2, atSeconds: 7 },
    { type: 'footstep', sequence: 3, atSeconds: 2 },
  ];
  const output = filterPlayerAnimationSignalsByLifetime(signals, 10, 2.5);
  assert.deepEqual(output.map((item) => item.sequence), [1]);
});

test('packet', () => {
  const packet = createPlayerAnimationSignalPacket([
    { type: 'footstep', sequence: 1, atSeconds: 10, intensity: 0.5 },
    { type: 'presentation-warning', sequence: 2, atSeconds: 9 },
    { type: 'transition', sequence: 3, atSeconds: 1 },
  ], 10);
  assert.equal(packet.count, 2);
  assert.equal(packet.warningCount, 1);
  assert.equal(packet.signals.length, 2);
});

test('types', () => {
  const types = getPlayerAnimationSignalTypes();
  assert.ok(types.includes('footstep'));
  assert.ok(types.includes('transition'));
  assert.equal(isPlayerAnimationSignalType('footstep'), true);
  assert.equal(isPlayerAnimationSignalType('garbage'), false);
});

test('limits-copy', () => {
  const limits = getPlayerAnimationSignalLimits();
  assert.equal(limits.maxSignals, PLAYER_ANIMATION_SIGNAL_LIMITS.maxSignals);
  assert.ok(Object.isFrozen(limits));
});

test('action-start-sanitize', () => {
  const signal = sanitizePlayerAnimationSignal({ type: 'action-start', action: 'heavy-attack', variant: 'wide' });
  assert.equal(signal.action, 'heavy-attack');
  assert.equal(signal.variant, 'wide');
});

test('surface-change-sanitize', () => {
  const signal = sanitizePlayerAnimationSignal({ type: 'surface-change', from: 'grass', to: 'stone', confidence: 4 });
  assert.equal(signal.confidence, 1);
  assert.equal(signal.from, 'grass');
  assert.equal(signal.to, 'stone');
});

test('deterministic-output', () => {
  const input = [
    { type: 'footstep', sequence: 4, atSeconds: 2.1, intensity: 0.7, phase: 0.6, materialKey: 'stone' },
    { type: 'transition', sequence: 5, atSeconds: 2.2, from: 'locomotion', to: 'sprint', reason: 'sprint-enter' },
  ];
  assert.equal(JSON.stringify(createPlayerAnimationSignalPacket(input, 2.3)), JSON.stringify(createPlayerAnimationSignalPacket(input, 2.3)));
});

console.log('PLAYER_ANIMATION_SIGNAL_SANITIZER_REGRESSION_PASS');
