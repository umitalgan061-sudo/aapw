import assert from 'node:assert/strict';
import {
  buildPlayerCombatFeedbackDispatchPlan,
  isPlayerCombatFeedbackDispatchPlan,
} from '../src/3d/gameplay/playerCombatFeedbackDispatchPlan.ts';

const base = buildPlayerCombatFeedbackDispatchPlan({
  profile: {},
  kind: 'light',
  staminaRatio: 0.92,
  poiseRatio: 0.88,
  outcome: 'attack',
});
assert.equal(base.accepted, true);
assert.equal(base.packets.length, 6);
assert.equal(isPlayerCombatFeedbackDispatchPlan(base), true);
assert.equal(Object.isFrozen(base), true);
assert.equal(Object.isFrozen(base.packets), true);
assert.equal(base.packets.every((entry) => Object.isFrozen(entry)), true);
assert.equal(base.packets[0].channel, 'animation');
assert.equal(base.packets.at(-1).channel, 'vfx');
assert.match(base.dispatchKey, /^attack:light:/);

const parry = buildPlayerCombatFeedbackDispatchPlan({
  profile: {},
  kind: 'heavy',
  staminaRatio: 0.9,
  poiseRatio: 0.9,
  outcome: 'guard',
  guardInput: true,
  parryWindowOpen: true,
});
assert.equal(parry.dominantCue, 'parry');
assert.equal(parry.packets.find((entry) => entry.channel === 'audio').cue, 'parry-ring');

const stagger = buildPlayerCombatFeedbackDispatchPlan({
  profile: {},
  kind: 'heavy',
  staminaRatio: 0.8,
  poiseRatio: 0.2,
  outcome: 'hit',
  rawAmount: 140,
  poise: 10,
  maxPoise: 100,
});
assert.equal(stagger.dominantCue, 'stagger');
assert.equal(stagger.packets.find((entry) => entry.channel === 'ui').cue, 'poise-break');

const repeat = buildPlayerCombatFeedbackDispatchPlan({
  profile: {},
  kind: 'heavy',
  staminaRatio: 0.8,
  poiseRatio: 0.2,
  outcome: 'hit',
  rawAmount: 140,
  poise: 10,
  maxPoise: 100,
});
assert.equal(repeat.dispatchKey, stagger.dispatchKey);
assert.deepEqual(repeat.packets, stagger.packets);

const tampered = { ...base, packets: [...base.packets] };
assert.equal(isPlayerCombatFeedbackDispatchPlan(tampered), false);

console.log('[checkPlayerCombatFeedbackDispatchPlan] PASS deterministic channels, parry/stagger projection, deep immutability, replay identity, and tamper rejection');
