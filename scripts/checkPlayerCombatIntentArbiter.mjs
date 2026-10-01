import assert from 'node:assert/strict';
import { resolvePlayerCombatIntent, validatePlayerCombatIntent } from '../src/3d/gameplay/playerCombatIntentArbiter.js';

const sample = {
  intents: [
    { action: 'lightAttack', source: 'keyboard', pressed: true, strength: 0.8, serial: 2 },
    { action: 'heavyAttack', source: 'touch', pressed: true, strength: 0.5, serial: 4 },
    { action: 'block', source: 'mouse', held: true, serial: 1 },
  ],
};
const first = resolvePlayerCombatIntent(sample);
const second = resolvePlayerCombatIntent({ intents: [...sample.intents].reverse() });
assert.equal(first.action, 'heavyAttack');
assert.equal(first.accepted, true);
assert.deepEqual(first.candidates, ['heavyAttack', 'lightAttack', 'block']);
assert.equal(first.blocked.length, 2);
assert.equal(validatePlayerCombatIntent(first), true);
assert.equal(Object.isFrozen(first), true);
assert.deepEqual(first, second);

const malformed = resolvePlayerCombatIntent({ intents: [
  { action: 'unknown', strength: Number.NaN },
  { action: 'dodge', held: true, strength: Number.POSITIVE_INFINITY },
] });
assert.equal(malformed.action, 'dodge');
assert.equal(malformed.strength, 1);
assert.equal(malformed.accepted, true);
assert.equal(validatePlayerCombatIntent(malformed), true);

const none = resolvePlayerCombatIntent({ intents: [{ action: 'block' }] });
assert.equal(none.accepted, false);
assert.equal(none.action, 'block');
console.log('player combat intent arbiter: PASS');