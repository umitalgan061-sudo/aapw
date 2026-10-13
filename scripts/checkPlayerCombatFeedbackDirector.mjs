import assert from 'node:assert/strict';
import {
  derivePlayerCombatFeedbackFrame,
  isPlayerCombatFeedbackFrame,
} from '../src/3d/gameplay/playerCombatFeedbackDirector.ts';

const greatswordPlate = {
  mainHand: { id: 'greatsword', kind: 'greatsword' },
  chest: { id: 'plate', kind: 'plate' },
  offHand: null,
};

const blocked = derivePlayerCombatFeedbackFrame(greatswordPlate, {
  rawAmount: 20,
  blockedAmount: 20,
  guardInput: true,
  poiseRatio: 0.9,
  nowMs: 120,
});
assert.equal(blocked.kind, 'blocked');
assert.equal(blocked.impact.effectiveImpact, 0);
assert.equal(blocked.presentation.sfxCue, 'block');

const parried = derivePlayerCombatFeedbackFrame(greatswordPlate, {
  rawAmount: 30,
  blockedAmount: 30,
  guardInput: true,
  parryWindowOpen: true,
  staminaRatio: 0.9,
  nowMs: 240,
});
assert.equal(parried.kind, 'parried');
assert.equal(parried.presentation.sfxCue, 'parry');

const dodge = derivePlayerCombatFeedbackFrame(greatswordPlate, {
  rawAmount: 30,
  dodgeInvulnerable: true,
  nowMs: 360,
});
assert.equal(dodge.kind, 'dodged');
assert.equal(dodge.presentation.sfxCue, 'dodge');

const stagger = derivePlayerCombatFeedbackFrame(greatswordPlate, {
  rawAmount: 90,
  poise: 10,
  maxPoise: 100,
  poiseRatio: 0.12,
  guardInput: true,
  nowMs: 480,
});
assert.equal(stagger.kind, 'guard-break');
assert.ok(stagger.presentation.intensity > 0);
assert.equal(stagger.presentation.vfxTier, 'heavy');

assert.ok(isPlayerCombatFeedbackFrame(stagger));
assert.ok(Object.isFrozen(stagger));
assert.ok(Object.isFrozen(stagger.presentation));
assert.equal(stagger.telemetry.emittedAtMs, 480);

const deterministicA = derivePlayerCombatFeedbackFrame(greatswordPlate, { rawAmount: 12, poise: 80, nowMs: 1 });
const deterministicB = derivePlayerCombatFeedbackFrame(greatswordPlate, { rawAmount: 12, poise: 80, nowMs: 1 });
assert.deepEqual(deterministicA, deterministicB);

console.log('[checkPlayerCombatFeedbackDirector] PASS blocked/parried/dodged/staggered feedback, bounded intensity, immutable frame and deterministic output');
