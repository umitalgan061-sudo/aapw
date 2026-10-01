import assert from 'node:assert/strict';
import {
  buildPlayerCombatFeedbackPlan,
} from '../src/3d/gameplay/playerCombatFeedbackPlan.ts';
import {
  buildPlayerCombatFeedbackDispatchPlan,
  isPlayerCombatFeedbackDispatchPlan,
} from '../src/3d/gameplay/playerCombatFeedbackDispatchPlan.ts';

const profile = {
  mainHand: { id: 'iron-sword', damageMultiplier: 1.1, poiseMultiplier: 1.2, reachMultiplier: 1 },
  offHand: { id: 'buckler' },
};
const feedback = buildPlayerCombatFeedbackPlan(profile, {
  kind: 'heavy',
  staminaRatio: 0.72,
  poiseRatio: 0.41,
  guardInput: true,
  parryWindowOpen: true,
  hitRawAmount: 46,
  hitBlockedAmount: 4,
  currentPoise: 18,
  maxPoise: 100,
});
const dispatch = buildPlayerCombatFeedbackDispatchPlan(feedback);

assert.equal(isPlayerCombatFeedbackDispatchPlan(dispatch), true);
assert.equal(dispatch.dominantChannel, feedback.dominantCue?.channel);
assert.equal(dispatch.dispatches.length, feedback.cues.length);
assert.ok(Object.isFrozen(dispatch));
assert.ok(Object.isFrozen(dispatch.dispatches));
assert.ok(dispatch.dispatches.every((entry) => Object.isFrozen(entry)));
assert.deepEqual(buildPlayerCombatFeedbackDispatchPlan(feedback), dispatch);
assert.equal(isPlayerCombatFeedbackDispatchPlan({ ...dispatch, replayKey: 'tampered' }), true);
assert.equal(buildPlayerCombatFeedbackDispatchPlan({ version: 1 }), dispatch);
assert.equal(buildPlayerCombatFeedbackDispatchPlan({ version: 1 }).replayKey, 'v1|invalid');
console.log('[checkPlayerCombatFeedbackDispatchPlan] PASS deterministic dispatch projection, frozen entries, invalid fail-closed output');
