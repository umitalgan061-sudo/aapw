import assert from 'node:assert/strict';
import {
  createPlayerCombatFeedbackBudget,
  summarizePlayerCombatFeedbackBudget,
  validatePlayerCombatFeedbackBudget,
} from '../src/3d/gameplay/playerCombatFeedbackBudget.js';

const source = [
  { id: 'hit-2', type: 'hit', sequence: 2, atSeconds: 0.05, intensity: 2, vfx: true, sfx: true, haptics: true },
  { id: 'hit-1', type: 'hit', sequence: 1, atSeconds: 0, intensity: 0.7, vfx: true, sfx: true, haptics: true },
  { id: 'blocked', type: 'blocked', sequence: 3, atSeconds: 0.04, vfx: true, sfx: true, haptics: true },
  { id: 'dodge', type: 'dodged', sequence: 4, atSeconds: 0.2, vfx: true, sfx: false, haptics: true },
];

const first = createPlayerCombatFeedbackBudget(source, 0.2, { cooldownFloorSeconds: 0.1 });
const second = createPlayerCombatFeedbackBudget([...source].reverse(), 0.2, { cooldownFloorSeconds: 0.1 });
assert.deepEqual(first, second, 'ordering must be deterministic');
assert.equal(first.count, 2, 'cooldown should suppress overlapping channel spam');
assert.equal(first.events[0].intensity, 0.7, 'events must be time ordered');
assert.equal(first.events[1].type, 'dodged');
assert.equal(validatePlayerCombatFeedbackBudget(first).ok, true);
assert.equal(first.events[0].channels.includes('vfx'), true);
assert.equal(first.events[0].channels.includes('sfx'), true);
assert.equal(first.events[1].channels.includes('sfx'), false);
assert.equal(Object.isFrozen(first), true);
assert.equal(Object.isFrozen(first.events), true);
const summary = summarizePlayerCombatFeedbackBudget(first);
assert.equal(summary.channelCounts.vfx, 2);
assert.equal(summary.channelCounts.sfx, 1);
assert.equal(summary.peakIntensity, 1);

const expired = createPlayerCombatFeedbackBudget([{ type: 'hit', atSeconds: 0, durationSeconds: 0.1 }], 1);
assert.equal(expired.count, 0, 'expired feedback must not be emitted');

console.log('player combat feedback budget: PASS');
