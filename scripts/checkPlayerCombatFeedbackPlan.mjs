import assert from 'node:assert/strict';
import { buildPlayerCombatFeedbackPlan, isPlayerCombatFeedbackPlan } from '../src/3d/gameplay/playerCombatFeedbackPlan.ts';

const profile = {
  mainHand: { id: 'iron-sword', damageMultiplier: 1.1, poiseMultiplier: 1.2, reachMultiplier: 1 },
  offHand: { id: 'buckler' },
  chest: { id: 'mail' },
  head: { id: 'helm' },
};

const input = {
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
};

const plan = buildPlayerCombatFeedbackPlan(profile, input);

assert.equal(isPlayerCombatFeedbackPlan(plan), true);
assert.equal(plan.dominantCue?.channel, 'stagger');
assert.ok(plan.cues.some((cue) => cue.channel === 'parry'));
assert.ok(plan.cues.some((cue) => cue.channel === 'attack'));
assert.ok(Object.isFrozen(plan));
assert.ok(Object.isFrozen(plan.cues));
assert.ok(plan.cues.every((cue) => Object.isFrozen(cue)));

const replay = buildPlayerCombatFeedbackPlan(profile, input);
assert.deepEqual(replay, plan);
assert.match(plan.replayKey, /^v1\|/);

assert.equal(isPlayerCombatFeedbackPlan({ ...plan, replayKey: 'tampered' }), false);
assert.equal(isPlayerCombatFeedbackPlan({ ...plan, dominantCue: plan.cues[1] ?? null }), false);
assert.equal(isPlayerCombatFeedbackPlan({
  ...plan,
  cues: Object.freeze(plan.cues.map((cue, index) => index === 0 ? { ...cue, audioKey: 'tampered' } : cue)),
}), false);

console.log('[checkPlayerCombatFeedbackPlan] PASS deterministic replay identity, canonical cue ordering, dominant stagger, parry/attack cues, deep freeze and guard rejection');
