import assert from 'node:assert/strict';
import { resolvePlayerCombatInputBuffer, isPlayerCombatInputBuffer } from '../src/3d/gameplay/playerCombatInputBuffer.ts';

const profile = {
  mainHand: { id: 'sword', damageMultiplier: 1, reachMultiplier: 1, poiseMultiplier: 1, projectile: false },
  armor: { staminaDrainMultiplier: 1, dodgeDistanceMultiplier: 1, movementMultiplier: 1, poiseBonus: 0 },
  ranged: false,
  twoHanded: false,
};

const accepted = resolvePlayerCombatInputBuffer(profile, {
  requestedKind: 'heavy',
  phase: 'active',
  phaseElapsedSeconds: 0.31,
  attackBusy: true,
  comboStep: 1,
  maxComboStep: 3,
  inputAgeSeconds: 0.08,
  staminaRatio: 0.85,
});
assert.equal(accepted.accepted, true);
assert.equal(accepted.reason, 'ready');
assert.equal(accepted.nextComboStep, 2);
assert.equal(isPlayerCombatInputBuffer(accepted), true);
assert(Object.isFrozen(accepted));
assert(Object.isFrozen(accepted.activeWindow));

const airborne = resolvePlayerCombatInputBuffer(profile, {
  phase: 'recovery',
  grounded: false,
  attackBusy: true,
  inputAgeSeconds: 0.08,
});
assert.equal(airborne.accepted, false);
assert.equal(airborne.reason, 'airborne');

const stale = resolvePlayerCombatInputBuffer(profile, {
  phase: 'recovery',
  attackBusy: true,
  inputAgeSeconds: 0.5,
});
assert.equal(stale.accepted, false);
assert.equal(stale.reason, 'outside-buffer-window');

const first = resolvePlayerCombatInputBuffer(profile, {
  phase: 'active',
  attackBusy: true,
  comboStep: 0,
  inputAgeSeconds: 0.1,
});
const second = resolvePlayerCombatInputBuffer(profile, {
  phase: 'active',
  attackBusy: true,
  comboStep: 0,
  inputAgeSeconds: 0.1,
});
assert.deepEqual(first, second);
assert.throws(() => { accepted.nextComboStep = 99; }, TypeError);
assert.equal(isPlayerCombatInputBuffer({ ...accepted, replayKey: 'tampered' }), false);

console.log('player combat input buffer checks passed');
