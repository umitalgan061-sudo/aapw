import assert from 'node:assert/strict';
import { buildPlayerCombatFeedbackPlan, isPlayerCombatFeedbackPlan } from '../src/3d/gameplay/playerCombatFeedbackPlan.ts';

const profile = {
  mainHand: { id: 'iron-sword', damageMultiplier: 1.1, poiseMultiplier: 1.2, reachMultiplier: 1 },
  offHand: { id: 'buckler' },
  chest: { id: 'mail' },
  head: { id: 'helm' },
};

const plan = buildPlayerCombatFeedbackPlan(profile, {
  kind: 'heavy',
  staminaRatio: 0.72,
  poiseRatio: 0.41,
  guardInput: true,
  parryWindowOpen: true,
  dodgeInvulnerable: false,
  hitRawAmount: 46,
  hitBlockedAmount: 4,
  currentPoise: 18,
  maxPoise: 100,
});

assert.equal(isPlayerCombatFeedbackPlan(plan), true);
assert.equal(plan.dominantCue?.channel, 'stagger');
assert.ok(plan.cues.some((cue) => cue.channel === 'parry'));
assert.ok(plan.cues.some((cue) => cue.channel === 'attack'));
assert.ok(Object.isFrozen(plan));
assert.ok(Object.isFrozen(plan.cues));
assert.ok(Object.isFrozen(plan.cues[0]));

const replay = buildPlayerCombatFeedbackPlan(profile, {
  kind: 'heavy',
  staminaRatio: 0.72,
  poiseRatio: 0.41,
  guardInput: true,
  parryWindowOpen: true,
  dodgeInvulnerable: false,
  hitRawAmount: 46,
  hitBlockedAmount: 4,
  currentPoise: 18,
  maxPoise: 100,
});
assert.deepEqual(replay, plan);

const tampered = { ...plan, replayKey: 'tampered' };
assert.equal(isPlayerCombatFeedbackPlan(tampered), false);

console.log('[checkPlayerCombatFeedbackPlan] PASS deterministic cue ordering, dominant stagger, parry/attack cues, deep freeze and guard rejection');
