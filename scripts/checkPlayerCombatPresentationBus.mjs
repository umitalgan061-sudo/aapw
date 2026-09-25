import assert from 'node:assert/strict';
import {
  createPlayerCombatPresentationBus,
  isPlayerCombatPresentationSnapshot,
  ATTACK_WINDOW_EVENT,
  COMBAT_FEEDBACK_EVENT,
} from '../src/3d/gameplay/playerCombatPresentationBus.ts';

const target = new EventTarget();
const bus = createPlayerCombatPresentationBus({ target, maxHistory: 2 });
assert.equal(bus.attach(), true);
assert.equal(bus.attach(), false);

target.dispatchEvent(new CustomEvent(ATTACK_WINDOW_EVENT, { detail: {
  serial: 1, kind: 'heavy', comboStep: 2, phase: 'active-start', active: true,
  stamina: 71.234, reachMeters: 2.1, damageScale: 1.65, commitRemainingMeters: 0.4,
  position: { x: 1, y: 0, z: 2 }, facing: { x: 0.25, z: 0.97 },
} }));
target.dispatchEvent(new CustomEvent(COMBAT_FEEDBACK_EVENT, { detail: {
  serial: 2, outcome: 'guard-break', rawAmount: 40, appliedAmount: 0, blockedAmount: 40,
  stamina: 0, poise: -4, state: 'guard-break', position: { x: 1, y: 0, z: 2 },
} }));

target.dispatchEvent(new CustomEvent(ATTACK_WINDOW_EVENT, { detail: { serial: 3, kind: 'light', phase: 'complete' } }));
const first = bus.snapshot();
assert.equal(isPlayerCombatPresentationSnapshot(first), true);
assert.equal(first.latestAttack.kind, 'light');
assert.equal(first.latestFeedback.outcome, 'guard-break');
assert.equal(first.attackHistory.length, 2);
assert.equal(first.latestFeedback.poise, 0);
assert.equal(Object.isFrozen(first), true);
assert.equal(Object.isFrozen(first.latestAttack), true);

const replayA = bus.snapshot();
const replayB = bus.snapshot();
assert.equal(replayA.key, replayB.key);
assert.throws(() => { first.attackHistory.push({}); }, TypeError);

const alternateTarget = new EventTarget();
const alternateBus = createPlayerCombatPresentationBus({ target: alternateTarget, maxHistory: 2 });
alternateBus.attach();
alternateTarget.dispatchEvent(new CustomEvent(ATTACK_WINDOW_EVENT, { detail: { serial: 1, kind: 'light', phase: 'complete' } }));
alternateTarget.dispatchEvent(new CustomEvent(ATTACK_WINDOW_EVENT, { detail: { serial: 3, kind: 'light', phase: 'complete' } }));
assert.equal(alternateBus.snapshot().latestAttack.kind, first.latestAttack.kind);
assert.equal(alternateBus.snapshot().attackHistory.length, first.attackHistory.length);
assert.notEqual(alternateBus.snapshot().key, first.key);

assert.equal(bus.clear().latestAttack, null);
assert.equal(bus.clear().feedbackHistory.length, 0);
assert.equal(bus.detach(), true);
assert.equal(bus.detach(), false);
console.log('Player combat presentation bus proof: PASS');
