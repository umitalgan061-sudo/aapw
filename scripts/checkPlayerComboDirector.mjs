import assert from 'node:assert/strict';
import {
  COMBO_STEPS,
  resolvePlayerComboFrame,
  resolvePlayerComboTransition,
  validatePlayerComboFrame,
} from '../src/3d/gameplay/playerComboDirector.ts';
import { resolvePlayerEquipmentCombatProfile } from '../src/3d/gameplay/playerEquipmentCombatProfile.ts';

const profile = resolvePlayerEquipmentCombatProfile({
  mainHand: { id: 'armingSword' },
  chest: { id: 'leather' },
  offHand: { id: 'buckler' },
});

const first = resolvePlayerComboFrame(profile, {
  requestedKind: 'light',
  comboStep: 0,
  phaseTime: 0,
  staminaRatio: 0.92,
  grounded: true,
});
assert.equal(first.availability.canStart, true);
assert.equal(first.next.kind, 'light');
assert.equal(first.next.step, 1);
assert.equal(validatePlayerComboFrame(first).ok, true);

const buffered = resolvePlayerComboFrame(profile, {
  requestedKind: 'light',
  comboStep: 1,
  phaseTime: 0.25,
  bufferedKind: 'heavy',
  staminaRatio: 0.92,
  grounded: true,
  attackBusy: true,
});
assert.equal(buffered.timing.bufferAccepted, true);
assert.equal(buffered.availability.canChain, true);
assert.equal(buffered.next.kind, 'heavy');
assert.equal(buffered.next.step, 2);

const exhausted = resolvePlayerComboFrame(profile, {
  requestedKind: 'heavy',
  comboStep: 0,
  staminaRatio: 0.04,
  grounded: true,
});
assert.equal(exhausted.availability.canStart, false);
assert.equal(exhausted.availability.staminaReady, false);

const broken = resolvePlayerComboFrame(profile, {
  requestedKind: 'light',
  comboStep: 1,
  phaseTime: 0.25,
  bufferedKind: 'light',
  staminaRatio: 0.9,
  grounded: true,
  attackBusy: true,
  guardBreak: true,
});
assert.equal(broken.availability.canChain, false);
assert.equal(broken.availability.guardBreak, true);

const terminal = resolvePlayerComboFrame(profile, {
  requestedKind: 'light',
  comboStep: COMBO_STEPS.light.length - 1,
  phaseTime: 0.3,
  bufferedKind: 'light',
  staminaRatio: 0.9,
  grounded: true,
  attackBusy: true,
});
assert.equal(terminal.next.terminal, true);

const transition = resolvePlayerComboTransition(profile, { kind: 'light', step: 1 }, {
  requestedKind: 'heavy',
  phaseTime: 0.3,
  staminaRatio: 0.9,
  grounded: true,
});
assert.equal(transition.accepted, true);
assert.equal(transition.reason, 'buffered-chain');

assert.equal(Object.isFrozen(first), true);
assert.equal(Object.isFrozen(first.next), true);
assert.equal(Object.isFrozen(first.envelope), true);

console.log('[checkPlayerComboDirector] PASS light/heavy chain timing, stamina gate, guard-break rejection, terminal step, deterministic transition, and immutability');
