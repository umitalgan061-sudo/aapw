import assert from 'node:assert/strict';
import { resolvePlayerStaminaMovement, validatePlayerStaminaMovementReceipt } from '../src/3d/gameplay/playerStaminaMovementDirector.js';

const equipment = { mainHand: { id: 'arming-sword' }, armor: { id: 'leather' } };
const input = { state: 'run', staminaRatio: 0.62, deltaSeconds: 0.1, grounded: true, inputMagnitude: 1, requestedSprint: true, attackBusy: false, guardActive: false, speedMps: 2.4, maxSpeedMps: 5.2 };
const a = resolvePlayerStaminaMovement(equipment, input);
const b = resolvePlayerStaminaMovement(equipment, input);
assert.deepEqual(a, b, 'replay must be deterministic');
assert.equal(validatePlayerStaminaMovementReceipt(a).ok, true);
assert.equal(a.effectiveState, 'sprint');
assert.ok(a.nextStaminaRatio < a.staminaRatio);
assert.ok(a.locomotion.targetSpeedMps > 0);
assert.throws(() => { a.locomotion.state = 'idle'; }, TypeError);

const guarded = resolvePlayerStaminaMovement(equipment, { ...input, guardActive: true });
assert.equal(guarded.effectiveState, 'run');
assert.equal(guarded.guardSuppressedSprint, true);
assert.equal(guarded.locomotion.sprinting, false);

const exhausted = resolvePlayerStaminaMovement(equipment, { ...input, staminaRatio: 0.01, requestedSprint: true });
assert.equal(exhausted.locomotion.sprintEligible, false);
assert.equal(exhausted.exhausted, true);
assert.equal(validatePlayerStaminaMovementReceipt(exhausted).ok, true);

console.log(JSON.stringify({
  deterministic: true,
  sprintState: a.effectiveState,
  guardedState: guarded.effectiveState,
  exhausted: exhausted.exhausted,
  nextStaminaRatio: a.nextStaminaRatio,
  targetSpeedMps: a.locomotion.targetSpeedMps,
}));
